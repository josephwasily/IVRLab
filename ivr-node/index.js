import ari from "ari-client";
import fetch from "node-fetch";

const ARI_URL = process.env.ARI_URL;
const ARI_USER = process.env.ARI_USER;
const ARI_PASS = process.env.ARI_PASS;
const APP_NAME = process.env.APP_NAME || "balance-ivr";
const BALANCE_API_URL = process.env.BALANCE_API_URL || "http://balance-api:3000";
const PLATFORM_API_URL = process.env.PLATFORM_API_URL || "http://platform-api:3001";

// Language configuration: "en" for English, "ar" for Arabic
const IVR_LANGUAGE = process.env.IVR_LANGUAGE || "ar";

// Sound paths based on language
const SOUND_PATHS = {
  en: {
    prompts: "custom",
    digits: "digits"
  },
  ar: {
    prompts: "ar",
    digits: "ar/digits"
  }
};

const PROMPTS = {
  enter_account: "enter_account",
  you_entered: "you_entered",
  press_1_confirm_2_reenter: "press_1_confirm_2_reenter",
  invalid_account: "invalid_account",
  retrieving_balance: "retrieving_balance",
  balance_is: "balance_is",
  currency_egp: "currency_egp",
  goodbye: "goodbye",
  could_not_retrieve: "could_not_retrieve",
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Call tracking API functions
async function startCallRecord(channelId) {
  try {
    const res = await fetch(`${BALANCE_API_URL}/api/call/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId })
    });
    const data = await res.json();
    console.log(`Call record started: callId=${data.callId}`);
    return data.callId;
  } catch (err) {
    console.error("Failed to start call record:", err.message);
    return null;
  }
}

async function updateCallAccount(callId, accountNumber) {
  if (!callId) return;
  try {
    await fetch(`${BALANCE_API_URL}/api/call/${callId}/account`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountNumber })
    });
    console.log(`Call ${callId}: account updated to ${accountNumber}`);
  } catch (err) {
    console.error("Failed to update call account:", err.message);
  }
}

async function updateCallBalance(callId, balance, currency) {
  if (!callId) return;
  try {
    await fetch(`${BALANCE_API_URL}/api/call/${callId}/balance`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ balance, currency })
    });
    console.log(`Call ${callId}: balance updated to ${balance} ${currency}`);
  } catch (err) {
    console.error("Failed to update call balance:", err.message);
  }
}

async function endCallRecord(callId, status) {
  if (!callId) return;
  try {
    await fetch(`${BALANCE_API_URL}/api/call/${callId}/end`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    console.log(`Call ${callId}: ended with status ${status}`);
  } catch (err) {
    console.error("Failed to end call record:", err.message);
  }
}

// Update outbound call status in platform API
async function updateOutboundCallStatus(callId, data) {
  if (!callId) return;
  try {
    await fetch(`${PLATFORM_API_URL}/api/triggers/call/${callId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    console.log(`Outbound call ${callId}: updated status`, data);
  } catch (err) {
    console.error("Failed to update outbound call status:", err.message);
  }
}


function getSoundPath(type) {
  const paths = SOUND_PATHS[IVR_LANGUAGE] || SOUND_PATHS.en;
  return paths[type];
}

async function playPrompt(channel, name) {
  // plays prompts based on language setting
  const promptPath = getSoundPath('prompts');
  console.log(`playPrompt: playing sound:${promptPath}/${name} (lang=${IVR_LANGUAGE})`);
  return new Promise((resolve, reject) => {
    let resolved = false;
    const done = (error) => {
      if (!resolved) {
        resolved = true;
        if (error) reject(error);
        else resolve();
      }
    };
    
    channel.play({ media: `sound:${promptPath}/${name}` }, (err, playback) => {
      if (err) {
        console.log(`playPrompt(${name}): error starting playback`, JSON.stringify(err));
        // If channel not found, reject to stop the flow
        if (err.message && err.message.includes("not found")) {
          return done(new Error("Channel gone"));
        }
        return done();
      }
      
      const playbackId = playback.id;
      const onFinished = (event, pb) => {
        // Only handle this specific playback's event
        if (pb && pb.id === playbackId) {
          console.log(`playPrompt(${name}): finished`);
          playback.removeListener('PlaybackFinished', onFinished);
          done();
        }
      };
      playback.on('PlaybackFinished', onFinished);
      
      // Timeout safety - resolve after 10s max (prompts are short)
      setTimeout(() => {
        playback.removeListener('PlaybackFinished', onFinished);
        console.log(`playPrompt(${name}): timeout, continuing`);
        done();
      }, 10000);
    });
  });
}

async function collectDigits(channel, { maxDigits, timeoutMs }) {
  const digits = [];
  console.log(`collectDigits: waiting for up to ${maxDigits} digits, timeout ${timeoutMs}ms`);
  return await new Promise((resolve) => {
    const onDtmf = (event) => {
      const d = event.digit;
      console.log(`collectDigits: received digit '${d}'`);
      if (d === "#") { cleanup(); return resolve(digits.join("")); }
      if (/^\d$/.test(d) && digits.length < maxDigits) digits.push(d);
      if (digits.length >= maxDigits) { cleanup(); return resolve(digits.join("")); }
    };
    const timer = setTimeout(() => { 
      console.log(`collectDigits: timeout, collected: '${digits.join("")}'`);
      cleanup(); 
      resolve(digits.join("")); 
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      channel.removeListener("ChannelDtmfReceived", onDtmf);
    }
    channel.on("ChannelDtmfReceived", onDtmf);
  });
}

async function playSound(channel, media) {
  return new Promise((resolve, reject) => {
    let resolved = false;
    const done = (error) => {
      if (!resolved) {
        resolved = true;
        if (error) reject(error);
        else resolve();
      }
    };
    
    channel.play({ media }, (err, playback) => {
      if (err) {
        console.log(`playSound(${media}): error starting playback`, JSON.stringify(err));
        // If channel not found, reject to stop the flow
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
      
      // Timeout safety - resolve after 5s max (digits are very short)
      setTimeout(() => {
        playback.removeListener('PlaybackFinished', onFinished);
        done();
      }, 5000);
    });
  });
}

async function sayDigits(channel, digits) {
  const digitsPath = getSoundPath('digits');
  console.log(`sayDigits: saying '${digits}' using path ${digitsPath} (lang=${IVR_LANGUAGE})`);
  for (const ch of digits) {
    try {
      await playSound(channel, `sound:${digitsPath}/${ch}`);
    } catch (err) {
      console.log(`sayDigits: channel gone, stopping`);
      throw err; // Propagate to stop further playback
    }
  }
}

async function sayNumber(channel, numberString) {
  const clean = String(numberString);
  const [intPart, fracPart] = clean.split(".");
  await sayDigits(channel, intPart);
  if (fracPart) {
    // Just say the decimal digits directly without a pause
    await sayDigits(channel, fracPart);
  }
}

async function getBalance(account, callId) {
  const url = `${BALANCE_API_URL}/balance?account=${encodeURIComponent(account)}${callId ? `&callId=${callId}` : ''}`;
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `api_error_${res.status}`);
  return body;
}

async function handleBalance(channel, acct, callId) {
  console.log(`handleBalance: fetching balance for account ${acct}`);
  try {
    await playPrompt(channel, PROMPTS.retrieving_balance);
    const { balance, currency } = await getBalance(acct, callId);
    console.log(`handleBalance: got balance ${balance} ${currency}`);
    
    // Update call record with balance
    await updateCallBalance(callId, balance, currency);

    await playPrompt(channel, PROMPTS.balance_is);
    // Small delay to ensure playback is fully done before speaking digits
    await sleep(200);
    
    await sayNumber(channel, balance);
    await sleep(200);

    // for POC we assume EGP prompt exists
    if ((currency || "").toUpperCase() === "EGP") {
      await playPrompt(channel, PROMPTS.currency_egp);
    }

    await playPrompt(channel, PROMPTS.goodbye);
    // Small delay to ensure goodbye fully plays
    await sleep(500);
    
    return 'completed';
  } catch (err) {
    console.error(`handleBalance error:`, err.message || err);
    // If channel is gone, don't try to play more prompts
    if (err.message === "Channel gone") {
      return 'abandoned';
    }
    try {
      await playPrompt(channel, PROMPTS.could_not_retrieve);
      await playPrompt(channel, PROMPTS.goodbye);
      await sleep(500);
    } catch (e) {
      console.error(`Error playing error prompts:`, e.message || e);
    }
    return 'balance_error';
  }
  // Hangup is handled by StasisStart after runIvr completes
}

async function safeHangup(channel) {
  try {
    await channel.hangup();
    console.log(`Channel hung up successfully`);
  } catch (e) {
    console.log(`Hangup failed (channel may already be gone)`);
  }
}

async function runIvr(channel, callId) {
  let finalStatus = 'abandoned';
  
  try {
    await playPrompt(channel, PROMPTS.enter_account);
    const acct = await collectDigits(channel, { maxDigits: 16, timeoutMs: 20000 });

    if (!/^\d{6,16}$/.test(acct)) {
      await playPrompt(channel, PROMPTS.invalid_account);
      await playPrompt(channel, PROMPTS.goodbye);
      await safeHangup(channel);
      finalStatus = 'invalid_account';
      return finalStatus;
    }
    
    // Update call record with account number
    await updateCallAccount(callId, acct);

    await playPrompt(channel, PROMPTS.you_entered);
    await sayDigits(channel, acct);
    await playPrompt(channel, PROMPTS.press_1_confirm_2_reenter);

    console.log(`Waiting for confirmation (1 or 2)...`);
    const choice = await collectDigits(channel, { maxDigits: 1, timeoutMs: 10000 });
    console.log(`User choice: '${choice}'`);

    if (choice === "2") {
      await playPrompt(channel, PROMPTS.enter_account);
      const acct2 = await collectDigits(channel, { maxDigits: 16, timeoutMs: 20000 });
      if (!/^\d{6,16}$/.test(acct2)) {
        await playPrompt(channel, PROMPTS.invalid_account);
        await playPrompt(channel, PROMPTS.goodbye);
        await safeHangup(channel);
        finalStatus = 'invalid_account';
        return finalStatus;
      }
      // Update with new account number
      await updateCallAccount(callId, acct2);
      finalStatus = await handleBalance(channel, acct2, callId);
      return finalStatus;
    }

    if (choice !== "1") {
      await playPrompt(channel, PROMPTS.goodbye);
      await safeHangup(channel);
      finalStatus = 'no_confirmation';
      return finalStatus;
    }

    finalStatus = await handleBalance(channel, acct, callId);
    return finalStatus;
  } catch (err) {
    console.error(`runIvr error:`, err);
    await safeHangup(channel);
    finalStatus = 'error';
    return finalStatus;
  }
}

async function main() {
  // Keep trying to connect to ARI until it becomes available. This prevents
  // the process from crashing when Asterisk/ARI isn't ready at container
  // startup (observed 503 errors). Retry indefinitely with a short backoff.
  let client;
  while (!client) {
    try {
      client = await ari.connect(ARI_URL, ARI_USER, ARI_PASS);
    } catch (err) {
      console.error("ARI connection failed, retrying in 3s:", err && err.message || err);
      await sleep(3000);
    }
  }

  // Track active channels and their call IDs
  const activeChannels = new Map(); // channelId -> { callId, outboundCallId }

  client.on("StasisEnd", async (event, channel) => {
    console.log(`StasisEnd: channel ${channel.id} left stasis`);
    const channelInfo = activeChannels.get(channel.id);
    if (channelInfo?.outboundCallId) {
      // User hung up - update the outbound call status
      await updateOutboundCallStatus(channelInfo.outboundCallId, {
        status: 'completed',
        end_time: new Date().toISOString(),
        hangup_cause: 'caller_hangup'
      });
    }
    activeChannels.delete(channel.id);
  });

  client.on("ChannelDestroyed", (event) => {
    console.log(`ChannelDestroyed: ${event.channel?.id || 'unknown'}`);
  });

  client.on("StasisStart", async (event, channel) => {
    if (event.application !== APP_NAME) return;
    console.log(`StasisStart: channel ${channel.id}`);
    
    // Check for outbound call ID (from AMI originate)
    // Channel variables need to be fetched via ARI
    let outboundCallId = null;
    try {
      console.log(`Checking for OUTBOUND_CALL_ID on channel ${channel.id}...`);
      const varResult = await channel.getChannelVar({ variable: 'OUTBOUND_CALL_ID' });
      outboundCallId = varResult.value;
      console.log(`Outbound call ID from channel var: ${outboundCallId}`);
    } catch (e) {
      // Variable not set - this is an inbound call
      console.log(`No OUTBOUND_CALL_ID found: ${e.message || 'not set'}`);
    }
    
    if (outboundCallId) {
      console.log(`Outbound call detected: ${outboundCallId}`);
      // Update call status to answered
      try {
        await updateOutboundCallStatus(outboundCallId, {
          status: 'answered',
          answer_time: new Date().toISOString(),
          channel_id: channel.id
        });
        console.log(`Updated outbound call status to answered`);
      } catch (e) {
        console.error(`Failed to update outbound call status: ${e.message}`);
      }
    }
    
    // Create call record immediately when call starts
    const callId = await startCallRecord(channel.id);
    activeChannels.set(channel.id, { callId, outboundCallId });
    
    let finalStatus = 'abandoned';
    let ivrResult = null;
    const startTime = Date.now();
    
    try {
      await channel.answer();
      const result = await runIvr(channel, callId);
      if (typeof result === 'object') {
        finalStatus = result.status || 'completed';
        ivrResult = result.data || result;
      } else {
        finalStatus = result;
      }
    } catch (e) {
      console.log(`StasisStart error:`, e.message);
      finalStatus = 'error';
    }
    
    const duration = Math.round((Date.now() - startTime) / 1000);
    
    // End call record with final status
    await endCallRecord(callId, finalStatus);
    
    // Update outbound call status if this was an outbound call
    if (outboundCallId) {
      await updateOutboundCallStatus(outboundCallId, {
        status: finalStatus === 'completed' || finalStatus === 'success' ? 'completed' : finalStatus,
        end_time: new Date().toISOString(),
        duration,
        result: ivrResult,
        hangup_cause: finalStatus
      });
    }
    
    // After IVR completes, hangup if channel still active
    if (activeChannels.has(channel.id)) {
      try {
        await channel.hangup();
        console.log(`Channel ${channel.id} hung up after IVR`);
      } catch (e) {
        console.log(`Post-IVR hangup failed: ${e.message}`);
      }
      activeChannels.delete(channel.id);
    } else {
      console.log(`Channel ${channel.id} already gone, no hangup needed`);
    }
  });

  try {
    await client.start(APP_NAME);
    console.log(`ARI IVR started: ${APP_NAME}`);
  } catch (err) {
    console.error("Failed to start ARI app:", err);
  }
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
