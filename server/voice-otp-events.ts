/**
 * Voice OTP Event Bus
 * Internal EventEmitter for real-time coordination between the voice-OTP call
 * origination layer and the retry/fallback engine in routes-bhaoo.ts.
 *
 * Usage:
 *   emit   → emitVoiceOtpFailed(data)  (from routes-voice-otp.ts or routes-bhaoo.ts)
 *   listen → voiceOtpEmitter.on('voice_otp_failed', handler)  (from routes-bhaoo.ts)
 */
import { EventEmitter } from 'events';

export interface VoiceOtpFailedEvent {
  callId: number;
  toNumber: string;
  otp?: string;
  fromMsgId?: number | null;
  profileId?: number | null;
}

export const voiceOtpEmitter = new EventEmitter();
voiceOtpEmitter.setMaxListeners(20);

export function emitVoiceOtpFailed(data: VoiceOtpFailedEvent): void {
  setImmediate(() => voiceOtpEmitter.emit('voice_otp_failed', data));
}
