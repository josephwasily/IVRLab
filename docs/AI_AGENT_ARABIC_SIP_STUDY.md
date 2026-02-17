# AI Conversational Agent Study for IVR-Lab

Date: February 16, 2026
Scope: Arabic quality, SIP compatibility, per-minute economics for conversational calls with knowledge base (KB), and open-source CAPEX/OPEX outlook.

## 1. Executive Verdict

1. Best near-term option for IVR-Lab: Retell AI.
2. Best Arabic voice quality ceiling: ElevenLabs.
3. Best long-run unit-cost potential: Open-source self-hosted stack (if you can absorb CAPEX + MLOps/telephony operations).

## 2. Decision Criteria

1. Arabic conversational quality (ASR/TTS and practical multilingual behavior).
2. SIP compatibility with SIP-native environments (Asterisk/PBX/trunking).
3. Cost per active minute for Arabic conversational calls with KB/RAG.
4. Time-to-market and implementation risk.

## 3. Arabic + SIP Comparison

Scoring scale: 1 (weak) to 5 (strong). Scores are inferred from official docs and product behavior, not independent MOS lab testing.

| Platform | Arabic Quality | SIP Compatibility | IVR-Lab Fit | Notes |
|---|---:|---:|---:|---|
| Retell AI | 4.4 | 5.0 | 4.8 | Strong custom telephony + SIP support with flexible call setup. |
| ElevenLabs Agents | 4.8 | 3.9 | 4.3 | Strong voice quality and Arabic support; SIP has transport constraints. |
| Vapi | 4.1 | 4.8 | 4.5 | Excellent BYO SIP flexibility; Arabic quality depends on selected providers. |
| Dialogflow CX | 4.2 | 4.1 | 3.9 | Enterprise-grade with supported Arabic; SIP via SBC/telephony integration. |
| LiveKit Agents (OSS) | 3.9 | 4.7 | 4.2 | Excellent SIP plumbing; quality depends on model stack you choose. |
| TEN framework (OSS) | 3.3 | 3.8 | 3.6 | Powerful framework, but more assembly effort for production-grade voice stack. |

## 4. Estimated Cost Per Minute (Arabic + KB + Conversation)

Important: where no single all-in public number exists, totals are calculated from published pricing components and marked as estimates.

Assumptions for comparability:

1. One active talk minute (excluding long silence discounts).
2. SIP carrier transport roughly +$0.01/min when not included.
3. KB is enabled.
4. Currency: USD.

| Option | Estimated $/min | Notes |
|---|---:|---|
| Retell AI | ~0.091 to 0.135 | Built from published component ranges (infra + voice + KB + LLM + transport). |
| ElevenLabs Agents | ~0.09 to 0.15 typical | Voice base depends on plan; LLM handling varies across docs/blog statements; transport may add cost. |
| Vapi | ~0.13 to 0.31 | Platform fee + STT + LLM + TTS + telephony. |
| Dialogflow CX | ~0.06 (Flows) to ~0.12 (Playbooks) before carrier | Voice billed per second; data-store pricing applies beyond free quota. |
| TEN/LiveKit OSS | Variable | No fixed agent-platform minute fee; pay infra + model providers (or self-host models). |

## 5. Open-Source Alternative (Full Stack)

Recommended reference architecture for IVR-Lab:

1. Telephony/control: existing Asterisk/Kamailio.
2. Real-time bridge: LiveKit SIP server (self-host).
3. Agent orchestration: Pipecat or custom runtime.
4. STT: faster-whisper (self-host) or managed fallback.
5. LLM: self-hosted instruct model via vLLM.
6. TTS: Coqui XTTS (Arabic-capable) or managed fallback.
7. KB/RAG: Qdrant or pgvector-based retrieval.

### 5.1 Cost Estimate (Open-Source)

Infra-only estimate (high utilization):

1. ~0.002 to 0.016 per minute.

Fully-loaded estimate (including engineering/ops burden):

1. ~0.04 to 0.11 per minute.

Carrier/telephony routing is typically extra.

### 5.2 CAPEX Estimate

1. POC-grade (single GPU node + supporting components): ~8k to 12k.
2. Production-grade (redundancy, 2-3 nodes, observability, failover): ~25k to 60k.

## 6. Recommendation for IVR-Lab

1. If goal is fastest production POC with Arabic and SIP: choose Retell AI first.
2. If voice naturalness in Arabic is top priority and SIP constraints are acceptable: evaluate ElevenLabs in parallel.
3. If long-term strategic cost/control dominates and team can operate speech/LLM infra: phase into OSS stack after managed pilot proves business metrics.

## 7. Risk Notes

1. Price policies and model pass-through can change; re-check vendor pricing before procurement.
2. Arabic quality differs by dialect and domain vocabulary; run pilot with your own call recordings/scripts.
3. Outbound persuasion/sales campaigns must be reviewed for local telecom and consent requirements.

## 8. Sources

1. Retell pricing: https://www.retellai.com/pricing
2. Retell custom telephony: https://docs.retellai.com/deploy/custom-telephony
3. Retell language support: https://docs.retellai.com/agent/language
4. Retell knowledge base: https://docs.retellai.com/build/knowledge-base
5. ElevenLabs agent pricing FAQ: https://help.elevenlabs.io/hc/en-us/articles/29298065878929-How-much-does-ElevenAgents-cost
6. ElevenLabs pricing update blog: https://elevenlabs.io/blog/we-cut-our-pricing-for-conversational-ai
7. ElevenLabs SIP trunking: https://elevenlabs.io/docs/eleven-agents/phone-numbers/sip-trunking
8. ElevenLabs language support: https://help.elevenlabs.io/hc/en-us/articles/13313366263441-What-languages-do-you-support
9. Vapi pricing: https://vapi.mintlify.app/pricing
10. Vapi cost examples: https://vapi.mintlify.app/billing/examples
11. Vapi SIP trunking: https://docs.vapi.ai/advanced/sip/sip-trunk
12. Dialogflow pricing: https://cloud.google.com/products/conversational-agents/pricing
13. Dialogflow CX language reference: https://cloud.google.com/dialogflow/cx/docs/reference/language
14. Dialogflow CX SIP integration: https://cloud.google.com/dialogflow/cx/docs/concept/integration/sip-trunk/overview
15. LiveKit self-host SIP server: https://docs.livekit.io/home/self-hosting/sip-server/
16. LiveKit telephony agents: https://docs.livekit.io/frontends/telephony/agents/
17. TEN framework repo: https://github.com/TEN-framework/ten-framework
18. Pipecat repo: https://github.com/pipecat-ai/pipecat
19. Coqui XTTS docs: https://docs.coqui.ai/en/latest/models/xtts.html
20. Lambda GPU pricing reference: https://lambda.ai/pricing

