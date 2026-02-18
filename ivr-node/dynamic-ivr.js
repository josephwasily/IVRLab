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

function buildBranchDisplayMap(flow) {
  const mapByVariable = {};
  if (!flow || !flow.nodes) return mapByVariable;

  for (const node of Object.values(flow.nodes)) {
    if (!node || node.type !== 'branch' || !node.variable) continue;
    const displayMap = node.branchDisplayNames || node.branchDisplayMap || {};
    if (!displayMap || typeof displayMap !== 'object') continue;
    if (!mapByVariable[node.variable]) {
      mapByVariable[node.variable] = {};
    }
    for (const [key, label] of Object.entries(displayMap)) {
      mapByVariable[node.variable][String(key)] = String(label);
    }
  }

  return mapByVariable;
}

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
    
    // Prompt cache: maps prompt names to file paths (from database)
    this.promptCache = flowConfig.promptCache || {};
    
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
    this.pendingDtmf = [];
    this.retryCount = {};
    this.startTime = new Date().toISOString();
    this.branchDisplayMap = buildBranchDisplayMap(this.flow);
    this.completedFlow = false;
    this.finalStatus = 'in_progress';
  }
  
  log(message, data = {}) {
    console.log(`[DynamicIVR][${this.extension}][${this.ivrName}] ${message}`, JSON.stringify(data));
  }
  
  /**
   * Get sound path for a prompt
   * Checks promptCache first (database prompts), then falls back to language paths
   */
  getPromptPath(promptName) {
    // Check if prompt is in cache (loaded from database)
    if (this.promptCache[promptName]) {
      const cachedPath = this.promptCache[promptName];
      // Remove .ulaw extension as Asterisk adds it automatically
      const pathWithoutExt = cachedPath.replace(/\.ulaw$/, '');
      this.log(`Using cached prompt: custom/${pathWithoutExt}`);
      return `custom/${pathWithoutExt}`;
    }
    
    // Fallback to language-based path for built-in prompts
    const paths = SOUND_PATHS[this.language] || SOUND_PATHS.en;
    return `${paths.prompts}/${promptName}`;
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
      if (this.finalStatus === 'in_progress') {
        this.finalStatus = this.completedFlow ? 'flow_completed' : 'flow_ended';
      }
    } catch (error) {
      this.log('Flow execution error', { error: error.message });
      if (error?.message === 'Channel gone') {
        this.finalStatus = 'caller_hangup_early';
      } else {
        this.finalStatus = 'error';
        await this.hangup();
      }
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
          this.completedFlow = true;
          this.finalStatus = 'flow_completed';
          await this.hangup();
          break;
        default:
          this.log(`Unknown node type: ${node.type}`);
          if (node.next) await this.executeNode(node.next);
          else await this.hangup();
      }
    } catch (error) {
      this.log(`Node error`, { nodeId, error: error.message });
      if (error?.message === 'Channel gone') {
        this.finalStatus = 'caller_hangup_early';
        return;
      }
      if (node.onError) {
        await this.executeNode(node.onError);
      } else {
        this.finalStatus = 'error';
        await this.hangup();
      }
    }
  }
  
  async handlePlay(node) {
    const promptPath = this.getPromptPath(node.prompt);
    const bargeInConfig = this.getBargeInConfig(node);
    const playbackResult = await this.playSound(promptPath, {
      bargeIn: bargeInConfig.enabled,
      queueDtmf: bargeInConfig.queueDtmf
    });
    
    if (bargeInConfig.enabled && playbackResult?.interrupted) {
      this.log('Prompt interrupted by DTMF', {
        queued: this.pendingDtmf.join(''),
        carry: bargeInConfig.queueDtmf
      });
    }
    
    if (node.maxRetries && node.next !== 'hangup') {
      this.retryCount[node.id] = (this.retryCount[node.id] || 0) + 1;
      if (this.retryCount[node.id] >= node.maxRetries) {
        return this.executeNode(node.onMaxRetries || 'hangup');
      }
    }
    
    if (node.next) await this.executeNode(node.next);
  }
  
  async handlePlayDigits(node) {
    const bargeInConfig = this.getBargeInConfig(node);
    let interrupted = false;
    
    if (node.prefix) {
      const r = await this.playSound(this.getPromptPath(node.prefix), {
        bargeIn: bargeInConfig.enabled,
        queueDtmf: bargeInConfig.queueDtmf
      });
      interrupted = !!r?.interrupted;
    }
    
    if (!interrupted) {
      const digits = this.getVariable(node.variable) || '';
      for (const digit of digits.toString()) {
        if (interrupted) break;
        if (/[0-9]/.test(digit)) {
          const r = await this.playSound(`${this.getSoundPath('digits')}/${digit}`, {
            bargeIn: bargeInConfig.enabled,
            queueDtmf: bargeInConfig.queueDtmf
          });
          interrupted = !!r?.interrupted;
        }
      }
    }
    
    if (!interrupted && node.suffix) {
      const r = await this.playSound(this.getPromptPath(node.suffix), {
        bargeIn: bargeInConfig.enabled,
        queueDtmf: bargeInConfig.queueDtmf
      });
      interrupted = !!r?.interrupted;
    }
    
    if (bargeInConfig.enabled && interrupted) {
      this.log('Play digits interrupted by DTMF', {
        queued: this.pendingDtmf.join(''),
        carry: bargeInConfig.queueDtmf
      });
    }
    
    if (node.next) await this.executeNode(node.next);
  }
  
  async handlePlaySequence(node) {
    const bargeInConfig = this.getBargeInConfig(node);
    let interrupted = false;
    
    for (const item of node.sequence) {
      if (interrupted) break;
      
      if (item.type === 'prompt') {
        const r = await this.playSound(this.getPromptPath(item.value), {
          bargeIn: bargeInConfig.enabled,
          queueDtmf: bargeInConfig.queueDtmf
        });
        interrupted = !!r?.interrupted;
      } else if (item.type === 'number') {
        // Say the number as a spoken word (e.g., "three hundred fifty three")
        const value = this.getVariable(item.variable);
        this.log(`Saying number: ${value}`);
        await this.sayNumber(value);
      } else if (item.type === 'digits') {
        // Say each digit individually (e.g., "3-5-3")
        const value = this.getVariable(item.variable);
        for (const digit of value.toString()) {
          if (interrupted) break;
          if (/[0-9]/.test(digit)) {
            const r = await this.playSound(`${this.getSoundPath('digits')}/${digit}`, {
              bargeIn: bargeInConfig.enabled,
              queueDtmf: bargeInConfig.queueDtmf
            });
            interrupted = !!r?.interrupted;
          }
        }
      }
    }
    
    if (bargeInConfig.enabled && interrupted) {
      this.log('Play sequence interrupted by DTMF', {
        queued: this.pendingDtmf.join(''),
        carry: bargeInConfig.queueDtmf
      });
    }
    
    if (node.next) await this.executeNode(node.next);
  }
  
  async handleCollect(node) {
    try {
      const digits = await this.collectDigits({
        maxDigits: node.maxDigits || 10,
        timeout: node.timeout || 10,
        terminators: node.terminators || '#',
        // Collect nodes are interruptible by default: first DTMF stops
        // the current prompt so callers can proceed immediately.
        bargeIn: node.bargeIn !== false,
        promptPath: node.prompt ? this.getPromptPath(node.prompt) : null
      });
      
      const minDigits = Number.isInteger(node.minDigits) ? node.minDigits : 1;
      const isEmpty = !digits || digits.length === 0;
      const isTooShort = !isEmpty && digits.length < minDigits;
      
      if (isEmpty || isTooShort) {
        this.retryCount[node.id] = (this.retryCount[node.id] || 0) + 1;
        
        if (isEmpty && node.onEmpty) return this.executeNode(node.onEmpty);
        if (isEmpty && node.onTimeout) return this.executeNode(node.onTimeout);
        if (isTooShort && node.onInvalid) return this.executeNode(node.onInvalid);
        
        // Default safe behavior: do not advance on empty input.
        // Retry the same collect node unless maxRetries is reached.
        const maxRetries = Number.isInteger(node.maxRetries) ? node.maxRetries : null;
        if (maxRetries !== null && this.retryCount[node.id] >= maxRetries) {
          if (node.onMaxRetries) return this.executeNode(node.onMaxRetries);
          return this.hangup();
        }
        
        this.log('Collect input invalid, retrying same node', {
          nodeId: node.id,
          retries: this.retryCount[node.id],
          reason: isEmpty ? 'empty' : 'too_short',
          minDigits,
          got: digits?.length || 0
        });
        return this.executeNode(node.id);
      }
      
      // Reset retry counter on successful input.
      this.retryCount[node.id] = 0;
      
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
      let value = this.getVariable(node.variable);
      
      // If caller barged-in during prior playback, branch can consume the
      // queued digit without forcing an extra collect prompt.
      if ((value === undefined || value === null || value === '') && this.pendingDtmf.length > 0) {
        value = this.pendingDtmf.shift();
        this.variables[node.variable] = value;
        if (node.variable !== 'dtmf_input') {
          this.variables.dtmf_input = value;
        }
        this.log(`Using queued DTMF for branch ${node.variable}: ${value}`);
      }
      
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
      // Build headers - start with default Content-Type
      const headers = { 'Content-Type': 'application/json' };
      
      // Add custom headers from node config
      if (node.headers) {
        for (const [key, value] of Object.entries(node.headers)) {
          headers[key] = this.interpolate(value);
        }
      }
      
      // Support shorthand authorization config
      if (node.authorization) {
        if (node.authorization.type === 'basic') {
          // Basic auth: encode credentials
          const credentials = this.interpolate(node.authorization.credentials);
          headers['Authorization'] = `Basic ${Buffer.from(credentials).toString('base64')}`;
        } else if (node.authorization.type === 'bearer') {
          headers['Authorization'] = `Bearer ${this.interpolate(node.authorization.token)}`;
        } else if (node.authorization.value) {
          // Direct value: "Basic <base64>" or any custom format
          headers['Authorization'] = this.interpolate(node.authorization.value);
        }
      }
      
      const options = {
        method,
        headers,
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
  
  /**
   * Say a number in Arabic using custom sound file composition
   * Decomposes the number into components and plays appropriate sound files
   * e.g., 353 = "ثلاثمائة و ثلاثة و خمسون" (three hundred and three and fifty)
   */
  async sayNumber(number) {
    const num = parseInt(number, 10);
    if (isNaN(num) || num < 0) {
      this.log(`Invalid number for sayNumber: ${number}`);
      return;
    }
    
    this.log(`Saying Arabic number: ${num}`);
    
    // Get the sound files to play for this number
    const soundFiles = this.decomposeArabicNumber(num);
    this.log(`Number decomposed to: ${soundFiles.join(', ')}`);
    
    // Play each sound file in sequence
    for (const soundFile of soundFiles) {
      await this.playSound(soundFile);
    }
  }
  
  /**
   * Decompose a number into Arabic sound file names
   * Arabic number pronunciation follows specific rules:
   * - For compound numbers, use "و" (wa) as connector
   * - Order: thousands, hundreds, tens, units
   */
  decomposeArabicNumber(num) {
    const basePath = 'ar/digits';
    const sounds = [];
    
    if (num === 0) {
      return [`${basePath}/0`];
    }
    
    let remaining = num;
    
    // Thousands (1000-9999)
    if (remaining >= 1000) {
      const thousands = Math.floor(remaining / 1000) * 1000;
      sounds.push(`${basePath}/${thousands}`);
      remaining = remaining % 1000;
      if (remaining > 0) sounds.push(`${basePath}/wa`);
    }
    
    // Hundreds (100-999)
    if (remaining >= 100) {
      const hundreds = Math.floor(remaining / 100) * 100;
      sounds.push(`${basePath}/${hundreds}`);
      remaining = remaining % 100;
      if (remaining > 0) sounds.push(`${basePath}/wa`);
    }
    
    // Handle 1-99
    if (remaining > 0) {
      if (remaining <= 19) {
        // Direct pronunciation for 1-19
        sounds.push(`${basePath}/${remaining}`);
      } else {
        // Tens and units (20-99)
        const tens = Math.floor(remaining / 10) * 10;
        const units = remaining % 10;
        
        // In Arabic: units come before tens for 21-99
        // e.g., 53 = "ثلاثة و خمسون" (three and fifty)
        if (units > 0) {
          sounds.push(`${basePath}/${units}`);
          sounds.push(`${basePath}/wa`);
        }
        sounds.push(`${basePath}/${tens}`);
      }
    }
    
    return sounds;
  }

  getBargeInConfig(node) {
    if (!node) return { enabled: false, queueDtmf: false };
    
    // Explicit node-level override.
    if (node.bargeIn === false) return { enabled: false, queueDtmf: false };
    
    const nextNode = this.flow.nodes?.[node.next];
    // Global default: prompt-playing nodes are interruptible unless disabled.
    let enabled = true;
    let queueDtmf = false;
    
    // If next is a branch, queued DTMF should drive branch selection.
    if (nextNode?.type === 'branch') {
      queueDtmf = true;
    }
    
    // If next is collect:
    // - always allow interrupt
    // - carry digits only when collect has no prompt (play is acting as prompt)
    if (nextNode?.type === 'collect') {
      enabled = true;
      queueDtmf = !nextNode.prompt;
    }
    
    // Force-enable if explicitly requested.
    if (node.bargeIn === true) {
      enabled = true;
    }
    
    // Optional per-node override for carry behavior.
    if (typeof node.queueDtmf === 'boolean') {
      queueDtmf = node.queueDtmf;
    }
    
    if (!enabled) queueDtmf = false;
    return { enabled, queueDtmf };
  }
  
  async playSound(soundPath, options = {}) {
    const { bargeIn = false, queueDtmf = false } = options;
    
    return new Promise((resolve, reject) => {
      let resolved = false;
      let playback = null;
      let onFinished = null;
      let onDtmf = null;
      let shouldStopPlayback = false;
      let interrupted = false;
      let stopping = false;
      let timeoutHandle = null;
      
      const done = (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutHandle);
          if (onDtmf) {
            this.channel.removeListener('ChannelDtmfReceived', onDtmf);
          }
          if (playback && onFinished) {
            playback.removeListener('PlaybackFinished', onFinished);
          }
          if (err) reject(err);
          else resolve({ interrupted });
        }
      };
      
      const stopPlayback = () => {
        if (!playback || stopping) return;
        stopping = true;
        const pb = playback;
        try {
          pb.stop(() => done());
        } catch (e) {
          done();
        }
      };
      
      if (bargeIn) {
        onDtmf = (event) => {
          const digit = event.digit;
          if (queueDtmf) {
            this.pendingDtmf.push(digit);
          }
          interrupted = true;
          shouldStopPlayback = true;
          stopPlayback();
        };
        this.channel.on('ChannelDtmfReceived', onDtmf);
      }
      
      this.channel.play({ media: `sound:${soundPath}` }, (err, pb) => {
        if (err) {
          if (err.message && err.message.includes("not found")) {
            return done(new Error("Channel gone"));
          }
          return done();
        }
        
        playback = pb;
        const playbackId = pb.id;
        onFinished = (event, pb) => {
          if (pb && pb.id === playbackId) {
            done();
          }
        };
        pb.on('PlaybackFinished', onFinished);
        
        if (bargeIn && shouldStopPlayback) {
          stopPlayback();
        }
        
        timeoutHandle = setTimeout(() => {
          done();
        }, 15000);
      });
    });
  }
  
  async collectDigits(options) {
    const { maxDigits, timeout, terminators, bargeIn = true, promptPath = null } = options;
    
    return new Promise((resolve) => {
      let digits = '';
      let timeoutHandle;
      let done = false;
      let playback = null;
      let onPlaybackFinished = null;
      let shouldStopPrompt = false;
      
      const stopPrompt = () => {
        if (!playback) return;
        const pb = playback;
        playback = null;
        if (onPlaybackFinished) {
          pb.removeListener('PlaybackFinished', onPlaybackFinished);
        }
        try {
          pb.stop(() => {});
        } catch (e) {
          // Ignore stop errors (already finished/channel gone)
        }
      };
      
      const finish = () => {
        if (done) return;
        done = true;
        cleanup();
        resolve(digits);
      };
      
      const applyDigit = (digit) => {
        if (terminators && terminators.includes(digit)) {
          finish();
          return true;
        }
        
        digits += digit;
        
        if (digits.length >= maxDigits) {
          finish();
          return true;
        }
        
        return false;
      };
      
      const cleanup = () => {
        clearTimeout(timeoutHandle);
        this.channel.removeListener('ChannelDtmfReceived', onDtmf);
        stopPrompt();
      };
      
      const resetTimeout = () => {
        clearTimeout(timeoutHandle);
        timeoutHandle = setTimeout(() => {
          finish();
        }, timeout * 1000);
      };
      
      const onDtmf = (event) => {
        const digit = event.digit;
        this.log(`DTMF received: ${digit}`);
        
        if (bargeIn) {
          shouldStopPrompt = true;
          stopPrompt();
        }
        
        if (applyDigit(digit)) return;
        resetTimeout();
      };
      
      // Consume digits pressed during previous barged-in playback.
      while (!done && this.pendingDtmf.length > 0) {
        const queuedDigit = this.pendingDtmf.shift();
        this.log(`Using queued DTMF: ${queuedDigit}`);
        if (applyDigit(queuedDigit)) break;
      }
      
      if (done) return;
      
      this.channel.on('ChannelDtmfReceived', onDtmf);
      resetTimeout();
      
      // Play collect prompt while already listening for DTMF.
      const shouldPlayPrompt = !!promptPath && !(bargeIn && digits.length > 0);
      if (shouldPlayPrompt) {
        this.channel.play({ media: `sound:${promptPath}` }, (err, pb) => {
          if (err || done) return;
          playback = pb;
          onPlaybackFinished = () => {
            playback = null;
          };
          pb.on('PlaybackFinished', onPlaybackFinished);
          
          // If a digit arrived before playback object was available.
          if (bargeIn && shouldStopPrompt) {
            stopPrompt();
          }
        });
      }
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

  getNormalizedVariablesForReporting() {
    const normalized = { ...this.variables };
    for (const [variableName, valueMap] of Object.entries(this.branchDisplayMap)) {
      if (!Object.prototype.hasOwnProperty.call(normalized, variableName)) continue;
      const rawValue = normalized[variableName];
      const mappedValue = valueMap[String(rawValue)];
      if (mappedValue !== undefined) {
        normalized[`${variableName}_raw`] = rawValue;
        normalized[variableName] = mappedValue;
      }
    }
    return normalized;
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
      variables: this.getNormalizedVariablesForReporting(),
      finalStatus: this.finalStatus,
      completedFlow: this.completedFlow
    };
  }
  
  async logCallToAPI() {
    const summary = this.getSummary();
    const analyticsStatus = (summary.finalStatus === 'flow_completed' || summary.finalStatus === 'flow_ended')
      ? 'completed'
      : 'failed';
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
          status: analyticsStatus,
          nodeHistory: summary.nodeHistory,
          dtmfInputs: summary.dtmfInputs,
          apiCalls: summary.apiCalls,
          variables: summary.variables  // Send all variables for filtering on server
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

  // Retry ARI connection until Asterisk/ARI is ready (handles 503 on startup)
  let client;
  while (!client) {
    try {
      client = await ari.connect(ARI_URL, ARI_USER, ARI_PASS);
    } catch (err) {
      console.error("ARI connection failed, retrying in 3s:", err && err.message || err);
      await sleep(3000);
    }
  }
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
          if (outboundCallId) {
            await updateOutboundCallStatus(outboundCallId, {
              status: 'failed',
              end_time: new Date().toISOString(),
              hangup_cause: 'ivr_not_found',
              result: { call_outcome: 'failed', reason: 'ivr_not_found' }
            });
          }
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
        const flowFinalStatus = ivrResult?.finalStatus || 'error';
        const outboundStatus = (flowFinalStatus === 'flow_completed' || flowFinalStatus === 'flow_ended')
          ? 'completed'
          : 'failed';
        const callOutcome = outboundStatus === 'completed'
          ? 'finished'
          : (flowFinalStatus === 'caller_hangup_early' ? 'abrupt_end' : 'failed');

        await updateOutboundCallStatus(outboundCallId, {
          status: outboundStatus,
          end_time: new Date().toISOString(),
          duration,
          result: {
            ...(ivrResult?.variables || {}),
            call_outcome: callOutcome,
            flow_final_status: flowFinalStatus
          },
          dtmf_inputs: ivrResult?.dtmfInputs || [],
          hangup_cause: flowFinalStatus
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
