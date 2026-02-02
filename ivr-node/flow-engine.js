/**
 * Dynamic IVR Flow Engine
 * Executes IVR flows loaded from database configuration
 */

const axios = require('axios');

class FlowEngine {
    constructor(client, channel, flowConfig, options = {}) {
        this.client = client;
        this.channel = channel;
        this.flow = flowConfig.flow;
        this.language = flowConfig.language || 'ar';
        this.settings = flowConfig.settings || {};
        this.ivrId = flowConfig.id;
        this.ivrName = flowConfig.name;
        
        // Runtime state
        this.variables = {
            caller_id: channel.caller ? channel.caller.number : 'unknown',
            channel_id: channel.id,
            ivr_id: flowConfig.id,
            ivr_name: flowConfig.name
        };
        this.currentNode = null;
        this.nodeHistory = [];
        this.dtmfInputs = [];
        this.apiCalls = [];
        this.retryCount = {};
        
        // Configuration
        this.soundBasePath = options.soundBasePath || `/var/lib/asterisk/sounds/${this.language}`;
        this.balanceApiUrl = options.balanceApiUrl || 'http://balance-api:3000';
        this.maxRetries = options.maxRetries || 3;
        
        // Bind methods
        this.execute = this.execute.bind(this);
    }
    
    log(message, data = {}) {
        console.log(`[FlowEngine][${this.ivrName}][${this.channel.id}] ${message}`, data);
    }
    
    async execute() {
        this.log('Starting flow execution');
        
        try {
            await this.channel.answer();
            await this.sleep(500);
            
            // Start from the first node
            await this.executeNode(this.flow.startNode);
        } catch (error) {
            this.log('Flow execution error', { error: error.message });
            await this.hangup();
        }
    }
    
    async executeNode(nodeId) {
        if (!nodeId) {
            this.log('No node ID provided, hanging up');
            return this.hangup();
        }
        
        const node = this.flow.nodes[nodeId];
        if (!node) {
            this.log(`Node not found: ${nodeId}, hanging up`);
            return this.hangup();
        }
        
        this.currentNode = node;
        this.nodeHistory.push(nodeId);
        this.log(`Executing node: ${nodeId}`, { type: node.type });
        
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
                    await this.executeNode(node.next);
            }
        } catch (error) {
            this.log(`Node execution error: ${nodeId}`, { error: error.message });
            
            if (node.onError) {
                await this.executeNode(node.onError);
            } else {
                await this.hangup();
            }
        }
    }
    
    async handlePlay(node) {
        const soundPath = this.getSoundPath(node.prompt);
        await this.playSound(soundPath);
        
        // Handle retry logic
        if (node.maxRetries && node.next !== 'hangup') {
            const retryKey = node.id;
            this.retryCount[retryKey] = (this.retryCount[retryKey] || 0) + 1;
            
            if (this.retryCount[retryKey] >= node.maxRetries) {
                return this.executeNode(node.onMaxRetries || 'hangup');
            }
        }
        
        await this.executeNode(node.next);
    }
    
    async handlePlayDigits(node) {
        // Play prefix prompt if specified
        if (node.prefix) {
            await this.playSound(this.getSoundPath(node.prefix));
        }
        
        // Get the digits to play
        const digits = this.getVariable(node.variable) || '';
        
        // Play each digit
        for (const digit of digits.toString()) {
            if (/[0-9]/.test(digit)) {
                await this.playSound(`${this.soundBasePath}/digits/${digit}`);
            }
        }
        
        // Play suffix if specified
        if (node.suffix) {
            await this.playSound(this.getSoundPath(node.suffix));
        }
        
        await this.executeNode(node.next);
    }
    
    async handlePlaySequence(node) {
        this.log(`handlePlaySequence: Processing ${node.sequence.length} items`);
        for (const item of node.sequence) {
            this.log(`handlePlaySequence: Item type=${item.type}, variable=${item.variable}, value=${item.value}`);
            switch (item.type) {
                case 'prompt':
                    await this.playSound(this.getSoundPath(item.value));
                    break;
                case 'number':
                    const number = this.getVariable(item.variable);
                    this.log(`handlePlaySequence: Got number value: ${number}`);
                    await this.sayNumber(number);
                    break;
                case 'digits':
                    const digits = this.getVariable(item.variable);
                    await this.sayDigits(digits);
                    break;
            }
        }
        
        await this.executeNode(node.next);
    }
    
    async handleCollect(node) {
        // Play prompt if specified
        if (node.prompt) {
            await this.playSound(this.getSoundPath(node.prompt));
        }
        
        try {
            const digits = await this.collectDigits({
                maxDigits: node.maxDigits || 10,
                timeout: node.timeout || 10,
                terminators: node.terminators || '#'
            });
            
            if (!digits || digits.length === 0) {
                this.log('No digits collected');
                if (node.onEmpty) {
                    return this.executeNode(node.onEmpty);
                }
                if (node.onTimeout) {
                    return this.executeNode(node.onTimeout);
                }
            }
            
            // Store the collected input
            this.variables.dtmf_input = digits;
            
            // Store with node-specific variable name if provided
            if (node.variable) {
                this.variables[node.variable] = digits;
            } else {
                // Default variable names based on context
                this.variables.account_number = digits;
            }
            
            this.dtmfInputs.push({ node: node.id, digits, timestamp: new Date().toISOString() });
            
            await this.executeNode(node.next);
        } catch (error) {
            this.log('Collect error', { error: error.message });
            if (node.onTimeout) {
                await this.executeNode(node.onTimeout);
            } else {
                await this.executeNode(node.next);
            }
        }
    }
    
    async handleBranch(node) {
        let nextNode = node.default;
        
        if (node.condition) {
            // Evaluate JavaScript condition
            try {
                const result = this.evaluateCondition(node.condition);
                nextNode = node.branches[result.toString()] || node.default;
            } catch (error) {
                this.log('Condition evaluation error', { error: error.message });
            }
        } else if (node.variable) {
            // Simple variable-based branching
            const value = this.getVariable(node.variable);
            nextNode = node.branches[value] || node.default;
        }
        
        this.log(`Branch decision: ${nextNode}`, { variable: node.variable, condition: node.condition });
        await this.executeNode(nextNode);
    }
    
    async handleApiCall(node) {
        const url = this.interpolate(node.url);
        const method = node.method || 'GET';
        
        this.log(`API call: ${method} ${url}`);
        
        try {
            let response;
            const config = {
                method,
                url,
                timeout: 10000
            };
            
            if (node.body) {
                config.data = this.interpolateObject(node.body);
            }
            
            if (node.headers) {
                config.headers = this.interpolateObject(node.headers);
            }
            
            response = await axios(config);
            
            // Store result
            const resultVar = node.resultVariable || 'api_result';
            this.variables[resultVar] = response.data;
            
            // Also store individual fields for easy access
            if (response.data && typeof response.data === 'object') {
                for (const [key, value] of Object.entries(response.data)) {
                    this.variables[`${resultVar}.${key}`] = value;
                }
            }
            
            this.apiCalls.push({
                node: node.id,
                url,
                method,
                status: response.status,
                timestamp: new Date().toISOString()
            });
            
            await this.executeNode(node.next);
        } catch (error) {
            this.log('API call error', { error: error.message });
            this.apiCalls.push({
                node: node.id,
                url,
                method,
                error: error.message,
                timestamp: new Date().toISOString()
            });
            
            if (node.onError) {
                await this.executeNode(node.onError);
            } else {
                await this.executeNode(node.next);
            }
        }
    }
    
    async handleSetVariable(node) {
        const value = node.expression 
            ? this.evaluateExpression(node.expression)
            : this.interpolate(node.value);
        
        this.variables[node.variable] = value;
        this.log(`Set variable: ${node.variable} = ${value}`);
        
        await this.executeNode(node.next);
    }
    
    async handleTransfer(node) {
        const destination = this.interpolate(node.destination);
        this.log(`Transferring to: ${destination}`);
        
        try {
            // Create a new channel to the destination
            const dialString = `PJSIP/${destination}`;
            
            // For blind transfer
            await this.channel.continueInDialplan({
                context: 'transfer',
                extension: destination,
                priority: 1
            });
        } catch (error) {
            this.log('Transfer error', { error: error.message });
            if (node.onError) {
                await this.executeNode(node.onError);
            } else {
                await this.hangup();
            }
        }
    }
    
    // Helper methods
    getSoundPath(prompt) {
        return `${this.soundBasePath}/${prompt}`;
    }
    
    getVariable(path) {
        const parts = path.split('.');
        let value = this.variables;
        
        for (const part of parts) {
            if (value === null || value === undefined) return undefined;
            value = value[part];
        }
        
        return value;
    }
    
    setVariable(path, value) {
        this.variables[path] = value;
    }
    
    interpolate(template) {
        if (!template) return template;
        
        return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (match, path) => {
            const value = this.getVariable(path);
            return value !== undefined ? value : match;
        });
    }
    
    interpolateObject(obj) {
        if (typeof obj === 'string') {
            return this.interpolate(obj);
        }
        
        if (Array.isArray(obj)) {
            return obj.map(item => this.interpolateObject(item));
        }
        
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
        // Simple condition evaluation
        // In production, use a proper expression parser
        try {
            const vars = this.variables;
            // Create a function that evaluates the condition with variables in scope
            const fn = new Function('vars', `
                with(vars) {
                    return (${condition});
                }
            `);
            return fn(vars);
        } catch (error) {
            this.log('Condition evaluation error', { condition, error: error.message });
            return false;
        }
    }
    
    evaluateExpression(expression) {
        try {
            const fn = new Function('vars', `
                with(vars) {
                    return (${expression});
                }
            `);
            return fn(this.variables);
        } catch (error) {
            this.log('Expression evaluation error', { expression, error: error.message });
            return null;
        }
    }
    
    async playSound(soundPath) {
        return new Promise((resolve, reject) => {
            const playback = this.client.Playback();
            
            playback.once('PlaybackFinished', () => {
                resolve();
            });
            
            this.channel.play({ media: `sound:${soundPath}` }, playback)
                .catch(reject);
        });
    }
    
    /**
     * Say a number in proper Arabic pronunciation
     * Handles thousands, hundreds, tens, and units with proper grammar
     * E.g., 1350 = "ألف وثلاثمائة وخمسون" (one thousand three hundred and fifty)
     * For decimals like 740.70, says the whole part as a number
     */
    async sayNumber(number) {
        this.log(`sayNumber called with: ${number} (type: ${typeof number})`);
        
        // Handle decimal numbers - use the integer part for currency
        const numStr = number.toString();
        const wholePart = numStr.includes('.') ? numStr.split('.')[0] : numStr;
        const num = parseInt(wholePart);
        
        this.log(`sayNumber parsed: ${num}`);
        
        if (isNaN(num) || num < 0) {
            this.log(`sayNumber: Invalid number, skipping`);
            return;
        }
        
        // Special case for zero
        if (num === 0) {
            this.log(`sayNumber: Playing zero`);
            await this.playSound(`${this.soundBasePath}/numbers/0`);
            return;
        }
        
        const parts = [];
        let remaining = num;
        
        // Thousands (1000-9999)
        if (remaining >= 1000) {
            const thousands = Math.floor(remaining / 1000) * 1000;
            parts.push(thousands.toString());
            remaining = remaining % 1000;
        }
        
        // Hundreds (100-900)
        if (remaining >= 100) {
            const hundreds = Math.floor(remaining / 100) * 100;
            parts.push(hundreds.toString());
            remaining = remaining % 100;
        }
        
        // Tens and units (1-99)
        if (remaining > 0) {
            if (remaining <= 19) {
                // 1-19 have unique words
                parts.push(remaining.toString());
            } else {
                // 20-99: tens + units
                const tens = Math.floor(remaining / 10) * 10;
                const units = remaining % 10;
                
                // In Arabic, units come before tens (e.g., "واحد وعشرون" = 21)
                if (units > 0) {
                    parts.push(units.toString());
                }
                parts.push(tens.toString());
            }
        }
        
        this.log(`sayNumber: Playing parts: ${JSON.stringify(parts)}`);
        
        // Play the parts with "wa" (و) connector between them
        for (let i = 0; i < parts.length; i++) {
            if (i > 0) {
                // Add "wa" (and) between parts
                this.log(`sayNumber: Playing 'wa' connector`);
                await this.playSound(`${this.soundBasePath}/numbers/wa`);
            }
            const soundPath = `${this.soundBasePath}/numbers/${parts[i]}`;
            this.log(`sayNumber: Playing ${soundPath}`);
            await this.playSound(soundPath);
        }
    }
    
    async sayDigits(digits) {
        const str = digits.toString();
        for (const digit of str) {
            if (/[0-9]/.test(digit)) {
                await this.playSound(`${this.soundBasePath}/digits/${digit}`);
            }
        }
    }
    
    async collectDigits(options) {
        const { maxDigits, timeout, terminators } = options;
        
        return new Promise((resolve, reject) => {
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
            // Channel might already be hung up
        }
    }
    
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    // Get execution summary for logging
    getSummary() {
        return {
            ivrId: this.ivrId,
            ivrName: this.ivrName,
            nodeHistory: this.nodeHistory,
            dtmfInputs: this.dtmfInputs,
            apiCalls: this.apiCalls,
            variables: this.variables
        };
    }
}

module.exports = FlowEngine;
