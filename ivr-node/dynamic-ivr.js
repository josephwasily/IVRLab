/**
 * Dynamic IVR Application
 * Loads IVR flows from Platform API and executes them dynamically
 */

import ari from "ari-client";
import fetch from "node-fetch";

const ARI_URL = process.env.ARI_URL;
const ARI_USER = process.env.ARI_USER;
const ARI_PASS = process.env.ARI_PASS;
const PLATFORM_API_URL = process.env.PLATFORM_API_URL || "http://platform-api:3001";
const BALANCE_API_URL = process.env.BALANCE_API_URL || "http://balance-api:3000";

// Default language
const DEFAULT_LANGUAGE = process.env.IVR_LANGUAGE || "ar";

// Sound paths based on language
const SOUND_PATHS = {
  en: { prompts: "custom", digits: "digits" },
  ar: { prompts: "ar", digits: "ar/digits" }
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Update outbound call status in platform API (internal endpoint - no auth required)
async function updateOutboundCallStatus(callId, data) {
  if (!callId) return;
  try {
    const response = await fetch(`${PLATFORM_API_URL}/api/engine/outbound-call/${callId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (response.ok) {
      console.log(`[Outbound] Updated call ${callId}:`, data);
    } else {
      console.error(`[Outbound] Failed to update ${callId}: ${response.status}`);
    }
  } catch (err) {
    console.error(`[Outbound] Error updating ${callId}:`, err.message);
  }
}

class DynamicFlowEngine {
  constructor(client, channel, flowConfig) {
    this.client = client;
    this.channel = channel;
    this.flow = flowConfig.flow;
    this.language = flowConfig.language || DEFAULT_LANGUAGE;
    this.settings = flowConfig.settings || {};
    this.ivrId = flowConfig.id;
    this.ivrName = flowConfig.name;
    this.extension = flowConfig.extension;
    
    // Runtime state
    this.variables = {
      caller_id: channel.caller ? channel.caller.number : 'unknown',
      channel_id: channel.id,
      ivr_id: flowConfig.id,
      ivr_name: flowConfig.name,
      extension: flowConfig.extension,
      BALANCE_API_URL: BALANCE_API_URL
    };
    this.currentNode = null;
    this.nodeHistory = [];
    this.dtmfInputs = [];
    this.apiCalls = [];
    this.retryCount = {};
    this.startTime = new Date().toISOString();
  }
  
  log(message, data = {}) {
    console.log(`[DynamicIVR][${this.extension}][${this.ivrName}] ${message}`, JSON.stringify(data));
  }
  
  getSoundPath(type) {
    const paths = SOUND_PATHS[this.language] || SOUND_PATHS.en;
    return paths[type];
  }
  
  async execute() {
    this.log('Starting flow execution', { startNode: this.flow.startNode });
    
    try {
      await this.channel.answer();
      await sleep(500);
      
      await this.executeNode(this.flow.startNode);
    } catch (error) {
      this.log('Flow execution error', { error: error.message });
      await this.hangup();
    }
    
    // Log the call to platform API for analytics
    await this.logCallToAPI();
    
    return this.getSummary();
  }
  
  async executeNode(nodeId) {
    if (!nodeId) {
      this.log('No node ID, hanging up');
      return this.hangup();
    }
    
    const node = this.flow.nodes[nodeId];
    if (!node) {
      this.log(`Node not found: ${nodeId}`);
      return this.hangup();
    }
    
    this.currentNode = node;
    this.nodeHistory.push(nodeId);
    this.log(`Executing node`, { nodeId, type: node.type });
    
    try {
      switch (node.type) {
        case 'play':
          await this.handlePlay(node);
          break;
        case 'play_digits':
          await this.handlePlayDigits(node);
          break;
        case 'play_sequence':
          await this.handlePlaySequence(node);
          break;
        case 'collect':
          await this.handleCollect(node);
          break;
        case 'branch':
          await this.handleBranch(node);
          break;
        case 'api_call':
          await this.handleApiCall(node);
          break;
        case 'set_variable':
          await this.handleSetVariable(node);
          break;
        case 'transfer':
          await this.handleTransfer(node);
          break;
        case 'hangup':
          await this.hangup();
          break;
        default:
          this.log(`Unknown node type: ${node.type}`);
          if (node.next) await this.executeNode(node.next);
          else await this.hangup();
      }
    } catch (error) {
      this.log(`Node error`, { nodeId, error: error.message });
      if (node.onError) {
        await this.executeNode(node.onError);
      } else {
        await this.hangup();
      }
    }
  }
  
  async handlePlay(node) {
    const promptPath = `${this.getSoundPath('prompts')}/${node.prompt}`;
    await this.playSound(promptPath);
    
    if (node.maxRetries && node.next !== 'hangup') {
      this.retryCount[node.id] = (this.retryCount[node.id] || 0) + 1;
      if (this.retryCount[node.id] >= node.maxRetries) {
        return this.executeNode(node.onMaxRetries || 'hangup');
      }
    }
    
    if (node.next) await this.executeNode(node.next);
  }
  
  async handlePlayDigits(node) {
    if (node.prefix) {
      await this.playSound(`${this.getSoundPath('prompts')}/${node.prefix}`);
    }
    
    const digits = this.getVariable(node.variable) || '';
    for (const digit of digits.toString()) {
      if (/[0-9]/.test(digit)) {
        await this.playSound(`${this.getSoundPath('digits')}/${digit}`);
      }
    }
    
    if (node.suffix) {
      await this.playSound(`${this.getSoundPath('prompts')}/${node.suffix}`);
    }
    
    if (node.next) await this.executeNode(node.next);
  }
  
  async handlePlaySequence(node) {
    for (const item of node.sequence) {
      if (item.type === 'prompt') {
        await this.playSound(`${this.getSoundPath('prompts')}/${item.value}`);
      } else if (item.type === 'number' || item.type === 'digits') {
        const value = this.getVariable(item.variable);
        for (const digit of value.toString()) {
          if (/[0-9]/.test(digit)) {
            await this.playSound(`${this.getSoundPath('digits')}/${digit}`);
          }
        }
      }
    }
    
    if (node.next) await this.executeNode(node.next);
  }
  
  async handleCollect(node) {
    if (node.prompt) {
      await this.playSound(`${this.getSoundPath('prompts')}/${node.prompt}`);
    }
    
    try {
      const digits = await this.collectDigits({
        maxDigits: node.maxDigits || 10,
        timeout: node.timeout || 10,
        terminators: node.terminators || '#'
      });
      
      if (!digits || digits.length === 0) {
        if (node.onEmpty) return this.executeNode(node.onEmpty);
        if (node.onTimeout) return this.executeNode(node.onTimeout);
      }
      
      this.variables.dtmf_input = digits;
      if (node.variable) {
        this.variables[node.variable] = digits;
      }
      // Only set account_number as fallback if node ID suggests it's for account collection
      if (!node.variable && node.id && node.id.includes('account')) {
        this.variables.account_number = digits;
      }
      
      this.dtmfInputs.push({ node: node.id, digits, timestamp: new Date().toISOString() });
      
      if (node.next) await this.executeNode(node.next);
    } catch (error) {
      this.log('Collect error', { error: error.message });
      if (node.onTimeout) {
        await this.executeNode(node.onTimeout);
      } else if (node.next) {
        await this.executeNode(node.next);
      }
    }
  }
  
  async handleBranch(node) {
    let nextNode = node.default;
    
    if (node.condition) {
      try {
        const result = this.evaluateCondition(node.condition);
        nextNode = node.branches[result.toString()] || node.default;
      } catch (error) {
        this.log('Condition error', { error: error.message });
      }
    } else if (node.variable) {
      const value = this.getVariable(node.variable);
      nextNode = node.branches[value] || node.default;
    }
    
    this.log(`Branch decision`, { nextNode });
    await this.executeNode(nextNode);
  }
  
  async handleApiCall(node) {
    const url = this.interpolate(node.url);
    const method = node.method || 'GET';
    
    this.log(`API call`, { method, url });
    
    try {
      const options = {
        method,
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      };
      
      if (node.body) {
        options.body = JSON.stringify(this.interpolateObject(node.body));
      }
      
      const response = await fetch(url, options);
      const data = await response.json();
      
      const resultVar = node.resultVariable || 'api_result';
      this.variables[resultVar] = data;
      
      if (data && typeof data === 'object') {
        for (const [key, value] of Object.entries(data)) {
          this.variables[`${resultVar}.${key}`] = value;
        }
      }
      
      this.apiCalls.push({
        node: node.id, url, method,
        status: response.status,
        timestamp: new Date().toISOString()
      });
      
      if (node.next) await this.executeNode(node.next);
    } catch (error) {
      this.log('API error', { error: error.message });
      this.apiCalls.push({
        node: node.id, url, method,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      
      if (node.onError) {
        await this.executeNode(node.onError);
      } else if (node.next) {
        await this.executeNode(node.next);
      }
    }
  }
  
  async handleSetVariable(node) {
    const value = node.expression 
      ? this.evaluateExpression(node.expression)
      : this.interpolate(node.value);
    
    this.variables[node.variable] = value;
    this.log(`Set variable`, { variable: node.variable, value });
    
    if (node.next) await this.executeNode(node.next);
  }
  
  async handleTransfer(node) {
    const destination = this.interpolate(node.destination);
    this.log(`Transfer`, { destination });
    
    try {
      await this.channel.continueInDialplan({
        context: 'transfer',
        extension: destination,
        priority: 1
      });
    } catch (error) {
      this.log('Transfer error', { error: error.message });
      if (node.onError) await this.executeNode(node.onError);
      else await this.hangup();
    }
  }
  
  // Utility methods
  getVariable(path) {
    const parts = path.split('.');
    let value = this.variables;
    for (const part of parts) {
      if (value === null || value === undefined) return undefined;
      value = value[part];
    }
    return value;
  }
  
  interpolate(template) {
    if (!template) return template;
    return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (match, path) => {
      const value = this.getVariable(path);
      return value !== undefined ? value : match;
    });
  }
  
  interpolateObject(obj) {
    if (typeof obj === 'string') return this.interpolate(obj);
    if (Array.isArray(obj)) return obj.map(item => this.interpolateObject(item));
    if (typeof obj === 'object' && obj !== null) {
      const result = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.interpolateObject(value);
      }
      return result;
    }
    return obj;
  }
  
  evaluateCondition(condition) {
    try {
      const fn = new Function('vars', `with(vars) { return (${condition}); }`);
      return fn(this.variables);
    } catch (error) {
      return false;
    }
  }
  
  evaluateExpression(expression) {
    try {
      const fn = new Function('vars', `with(vars) { return (${expression}); }`);
      return fn(this.variables);
    } catch (error) {
      return null;
    }
  }
  
  async playSound(soundPath) {
    return new Promise((resolve, reject) => {
      let resolved = false;
      const done = (err) => {
        if (!resolved) {
          resolved = true;
          if (err) reject(err);
          else resolve();
        }
      };
      
      this.channel.play({ media: `sound:${soundPath}` }, (err, playback) => {
        if (err) {
          if (err.message && err.message.includes("not found")) {
            return done(new Error("Channel gone"));
          }
          return done();
        }
        
        const playbackId = playback.id;
        const onFinished = (event, pb) => {
          if (pb && pb.id === playbackId) {
            playback.removeListener('PlaybackFinished', onFinished);
            done();
          }
        };
        playback.on('PlaybackFinished', onFinished);
        
        setTimeout(() => {
          playback.removeListener('PlaybackFinished', onFinished);
          done();
        }, 15000);
      });
    });
  }
  
  async collectDigits(options) {
    const { maxDigits, timeout, terminators } = options;
    
    return new Promise((resolve) => {
      let digits = '';
      let timeoutHandle;
      
      const cleanup = () => {
        clearTimeout(timeoutHandle);
        this.channel.removeAllListeners('ChannelDtmfReceived');
      };
      
      const resetTimeout = () => {
        clearTimeout(timeoutHandle);
        timeoutHandle = setTimeout(() => {
          cleanup();
          resolve(digits);
        }, timeout * 1000);
      };
      
      resetTimeout();
      
      this.channel.on('ChannelDtmfReceived', (event) => {
        const digit = event.digit;
        this.log(`DTMF received: ${digit}`);
        
        if (terminators && terminators.includes(digit)) {
          cleanup();
          resolve(digits);
          return;
        }
        
        digits += digit;
        resetTimeout();
        
        if (digits.length >= maxDigits) {
          cleanup();
          resolve(digits);
        }
      });
    });
  }
  
  async hangup() {
    this.log('Hanging up');
    try {
      await this.channel.hangup();
    } catch (error) {
      // Already hung up
    }
  }
  
  getSummary() {
    return {
      ivrId: this.ivrId,
      ivrName: this.ivrName,
      extension: this.extension,
      callerId: this.variables.caller_id,
      startTime: this.startTime,
      endTime: new Date().toISOString(),
      nodeHistory: this.nodeHistory,
      dtmfInputs: this.dtmfInputs,
      apiCalls: this.apiCalls,
      variables: this.variables
    };
  }
  
  async logCallToAPI() {
    const summary = this.getSummary();
    try {
      const response = await fetch(`${PLATFORM_API_URL}/api/engine/call-log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ivrId: summary.ivrId,
          extension: summary.extension,
          callerId: summary.callerId,
          startTime: summary.startTime,
          endTime: summary.endTime,
          status: 'completed',
          nodeHistory: summary.nodeHistory,
          dtmfInputs: summary.dtmfInputs,
          apiCalls: summary.apiCalls
        })
      });
      if (response.ok) {
        this.log('Call logged to platform API');
      } else {
        this.log('Failed to log call to platform API', { status: response.status });
      }
    } catch (error) {
      this.log('Error logging call to platform API', { error: error.message });
    }
  }
}

// Fetch IVR flow from Platform API
async function fetchIVRFlow(extension) {
  try {
    const response = await fetch(`${PLATFORM_API_URL}/api/engine/flow/${extension}`);
    if (!response.ok) {
      console.log(`No IVR found for extension ${extension}: ${response.status}`);
      return null;
    }
    const data = await response.json();
    console.log(`Loaded IVR flow for extension ${extension}: ${data.name}`);
    return data;
  } catch (error) {
    console.error(`Failed to fetch IVR flow for ${extension}:`, error.message);
    return null;
  }
}

async function main() {
  console.log("Connecting to Asterisk ARI (Dynamic IVR Engine)...");
  console.log(`Platform API: ${PLATFORM_API_URL}`);
  
  const client = await ari.connect(ARI_URL, ARI_USER, ARI_PASS);
  console.log("Connected to ARI");

  const activeChannels = new Map();

  // Debug: Log all DTMF events at client level
  client.on("ChannelDtmfReceived", (event, channel) => {
    console.log(`[DEBUG] Client-level DTMF: channel=${channel.id}, digit=${event.digit}`);
  });

  client.on("ChannelDestroyed", (event, channel) => {
    if (activeChannels.has(channel.id)) {
      console.log(`Channel ${channel.id} destroyed`);
      activeChannels.delete(channel.id);
    }
  });

  // Handle legacy balance-ivr app (extension 6000)
  client.on("StasisStart", async (event, channel) => {
    if (event.application === 'balance-ivr') {
      console.log(`StasisStart (balance-ivr): channel ${channel.id}`);
      activeChannels.set(channel.id, { extension: '6000' });
      
      // Use the same Balance Inquiry flow as extension 2001
      try {
        const flowConfig = await fetchIVRFlow('2001');
        if (flowConfig) {
          flowConfig.extension = '6000';
          const engine = new DynamicFlowEngine(client, channel, flowConfig);
          await engine.execute();
        } else {
          // Fallback - just play a message
          await channel.answer();
          await sleep(300);
          try {
            await new Promise((resolve) => {
              channel.play({ media: 'sound:ar/enter_account' }, (err, pb) => {
                if (err) return resolve();
                pb.once('PlaybackFinished', resolve);
                setTimeout(resolve, 10000);
              });
            });
          } catch (e) {}
          await channel.hangup();
        }
      } catch (error) {
        console.error('Error in balance-ivr:', error);
      }
      
      if (activeChannels.has(channel.id)) {
        try { await channel.hangup(); } catch (e) {}
        activeChannels.delete(channel.id);
      }
      return;
    }
    
    // Handle dynamic IVR engine calls (ivr-engine app)
    if (event.application === 'ivr-engine') {
      const extension = event.args?.[0];
      console.log(`StasisStart (ivr-engine): channel ${channel.id}, extension ${extension}`);
      
      if (!extension) {
        console.log('No extension provided');
        await channel.hangup();
        return;
      }
      
      // Check for outbound call ID (from AMI originate)
      let outboundCallId = null;
      const startTime = Date.now();
      try {
        const varResult = await channel.getChannelVar({ variable: 'OUTBOUND_CALL_ID' });
        outboundCallId = varResult.value;
        console.log(`[Outbound] Detected outbound call ID: ${outboundCallId}`);
        
        // Update call status to answered
        await updateOutboundCallStatus(outboundCallId, {
          status: 'answered',
          answer_time: new Date().toISOString(),
          channel_id: channel.id
        });
      } catch (e) {
        // Variable not set - this is an inbound call
        console.log(`[Call] Inbound call on extension ${extension}`);
      }
      
      activeChannels.set(channel.id, { extension, outboundCallId });
      
      let ivrResult = null;
      
      try {
        // Fetch IVR configuration from Platform API
        const flowConfig = await fetchIVRFlow(extension);
        
        if (!flowConfig) {
          console.log(`No IVR configured for extension ${extension}`);
          // Play error message and hangup
          try {
            await channel.answer();
            await sleep(300);
            await new Promise((resolve) => {
              channel.play({ media: 'sound:invalid' }, (err, playback) => {
                if (err) return resolve();
                playback.once('PlaybackFinished', resolve);
                setTimeout(resolve, 3000);
              });
            });
          } catch (e) {}
          await channel.hangup();
          return;
        }
        
        // Execute the dynamic flow
        const engine = new DynamicFlowEngine(client, channel, flowConfig);
        ivrResult = await engine.execute();
        
        console.log(`IVR completed for ${extension}:`, JSON.stringify(ivrResult, null, 2));
        
      } catch (error) {
        console.error(`Error handling call on ${extension}:`, error);
      }
      
      // Update outbound call status if this was an outbound call
      if (outboundCallId) {
        const duration = Math.round((Date.now() - startTime) / 1000);
        await updateOutboundCallStatus(outboundCallId, {
          status: 'completed',
          end_time: new Date().toISOString(),
          duration,
          result: ivrResult?.variables || {},
          dtmf_inputs: ivrResult?.dtmfInputs || [],
          hangup_cause: ivrResult?.finalStatus || 'normal'
        });
      }
      
      // Cleanup
      if (activeChannels.has(channel.id)) {
        try {
          await channel.hangup();
        } catch (e) {}
        activeChannels.delete(channel.id);
      }
    }
  });

  // Start the application (handles both ivr-engine and balance-ivr)
  try {
    await client.start(['ivr-engine', 'balance-ivr']);
    console.log('Dynamic IVR Engine started (ivr-engine, balance-ivr)');
  } catch (err) {
    console.error("Failed to start applications:", err);
  }
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
