import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import type { SpeechPriority } from './copy';

/**
 * Voice coach. The phone sits on the floor 2 m away during a set, so sound is
 * the only feedback channel that reaches the user; haptics only help while
 * the phone is still in their hand during setup.
 */
export class Coach {
  private speaking = false;
  /** Increments per utterance, so callbacks from a stopped one are ignored. */
  private utterance = 0;
  private lastText = '';
  private lastAt = 0;

  constructor(private enabled: boolean) {}

  setEnabled(v: boolean) {
    this.enabled = v;
    if (!v) void Speech.stop();
  }

  say(text: string, priority: SpeechPriority = 'normal') {
    if (!this.enabled || !text) return;
    const now = Date.now();
    if (text === this.lastText && now - this.lastAt < 1500) return;
    // Rep counts must be on time: cut off whatever is being said.
    if (priority === 'high') void Speech.stop();
    // 'queued' plays after the current line (the speech engine queues it).
    else if (priority === 'normal' && this.speaking) return; // never queue chatter behind chatter
    this.lastText = text;
    this.lastAt = now;
    this.speaking = true;
    const id = ++this.utterance;
    // Speech.stop() reports the *previous* utterance as stopped asynchronously,
    // after this one has started; only this utterance may clear the flag.
    const finished = () => {
      if (id === this.utterance) this.speaking = false;
    };
    try {
      Speech.speak(text, {
        rate: priority === 'normal' ? 1.0 : 1.05,
        pitch: 1.0,
        onDone: finished,
        onStopped: finished,
        onError: finished,
      });
    } catch {
      finished();
    }
  }

  stop() {
    void Speech.stop();
    this.speaking = false;
  }
}

export function tapLight() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

export function tapSuccess() {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}
