// Every audible game cue is loaded from bundled, human-authored sound-effect files.
// This module does not synthesize audio at runtime.
const SOUND_ASSETS = {
  confirmation: new URL('./assets/audio/equip-interface.wav', import.meta.url).href,
  drop: new URL('./assets/audio/orb-roll.ogg', import.meta.url).href,
  glass: new URL('./assets/audio/rarity-magic.wav', import.meta.url).href,
  error: new URL('./assets/audio/error-interface.wav', import.meta.url).href,
  levelUp: new URL('./assets/audio/level-up.wav', import.meta.url).href,
  reward: new URL('./assets/audio/reward-coin.wav', import.meta.url).href,
  sacrifice: new URL('./assets/audio/sacrifice-downer.wav', import.meta.url).href,
  sonar: new URL('./assets/audio/sonar-ping.ogg', import.meta.url).href,
  alignment: new URL('./assets/audio/alignment-phase.ogg', import.meta.url).href,
  powerUp: new URL('./assets/audio/power-up.ogg', import.meta.url).href,
};

class SoundFX {
  public enabled = true;
  public sonarMode = false;
  public sonarThreshold = 100;
  public sonarAlertMode: 'near-best' | 'new-best' = 'near-best';
  public sonarAlignmentSoundsAllowed = false;
  public alignmentSoundEnabled = true;
  private sonarModeListeners = new Set<(active: boolean) => void>();

  private playSample(url: string, volume = 0.16, allowSonarMode = false): void {
    if (!this.enabled || (this.sonarMode && !allowSonarMode)) return;
    try {
      if (typeof window === 'undefined' || typeof Audio === 'undefined') return;
      const clip = new Audio(url);
      clip.preload = 'auto';
      clip.volume = Math.max(0, Math.min(1, volume));
      void clip.play().catch(() => undefined);
    } catch {
      // Blocked or unsupported samples must never interrupt gameplay.
    }
  }

  public playEquip(): void { this.playSample(SOUND_ASSETS.confirmation, 0.11); }
  public playError(): void { this.playSample(SOUND_ASSETS.error, 0.12); }

  constructor() {
    try {
      const saved = localStorage.getItem('orbs_sound_enabled');
      this.enabled = saved !== null ? saved === 'true' : true;
      this.sonarMode = localStorage.getItem('orbs_sonar_mode') === 'true';
      this.sonarAlertMode = localStorage.getItem('orbs_sonar_alert_mode') === 'new-best' ? 'new-best' : 'near-best';
      this.sonarAlignmentSoundsAllowed = localStorage.getItem('orbs_sonar_alignment_sounds') === 'true';
      this.alignmentSoundEnabled = localStorage.getItem('io_alignment_sound') !== 'false';
      const savedThreshold = localStorage.getItem('orbs_sonar_threshold');
      if (savedThreshold) {
        this.sonarThreshold = Math.max(10, parseInt(savedThreshold, 10) || 100);
      }
    } catch {
      this.enabled = true;
      this.sonarMode = false;
      this.sonarThreshold = 100;
      this.sonarAlertMode = 'near-best';
      this.sonarAlignmentSoundsAllowed = false;
      this.alignmentSoundEnabled = true;
    }
  }

  public toggle(): boolean {
    this.enabled = !this.enabled;
    try {
      localStorage.setItem('orbs_sound_enabled', String(this.enabled));
    } catch {}
    if (this.enabled) this.playEquip();
    return this.enabled;
  }

  public subscribeSonarMode(listener: (active: boolean) => void): () => void {
    this.sonarModeListeners.add(listener);
    return () => {
      this.sonarModeListeners.delete(listener);
    };
  }

  public setSonarMode(active: boolean) {
    this.sonarMode = active;
    try {
      localStorage.setItem('orbs_sonar_mode', String(active));
    } catch {}
    for (const listener of this.sonarModeListeners) {
      try { listener(active); } catch {}
    }
    if (active) this.playSonarPing(this.sonarThreshold);
  }

  public setSonarThreshold(threshold: number) {
    this.sonarThreshold = threshold;
    try {
      localStorage.setItem('orbs_sonar_threshold', String(threshold));
    } catch {}
    this.playSonarPing(threshold);
  }

  public setSonarAlertMode(mode: 'near-best' | 'new-best'): void {
    this.sonarAlertMode = mode === 'new-best' ? 'new-best' : 'near-best';
    try { localStorage.setItem('orbs_sonar_alert_mode', this.sonarAlertMode); } catch {}
  }

  public setSonarAlignmentSoundsAllowed(enabled: boolean): void {
    this.sonarAlignmentSoundsAllowed = Boolean(enabled);
    try { localStorage.setItem('orbs_sonar_alignment_sounds', String(this.sonarAlignmentSoundsAllowed)); } catch {}
  }

  // General interface clicks remain silent; action/reward sounds are event-specific.
  public playClick() {}

  public playPurchaseSound(): void {
    this.playSample(SOUND_ASSETS.levelUp, 0.12);
  }

  public playPowerUpSound(): void {
    this.playSample(SOUND_ASSETS.powerUp, 0.14);
  }

  public playRewardSound(): void {
    this.playSample(SOUND_ASSETS.reward, 0.13);
  }

  public playRollNormal(): void {
    this.playSample(SOUND_ASSETS.drop, 0.13);
  }

  public setAlignmentSoundEnabled(enabled: boolean): void {
    this.alignmentSoundEnabled = Boolean(enabled);
    try { localStorage.setItem('io_alignment_sound', String(this.alignmentSoundEnabled)); } catch { /* Session setting remains active. */ }
  }

  public playAlignmentPrompt(): void {
    if (!this.alignmentSoundEnabled) return;
    this.playSample(SOUND_ASSETS.alignment, 0.14, this.sonarAlignmentSoundsAllowed);
  }

  public playSonarPing(rarity: number): void {
    const volume = rarity >= 10_000 ? 0.16 : rarity >= 1_000 ? 0.14 : 0.12;
    this.playSample(SOUND_ASSETS.sonar, volume, true);
  }

  public playRareRiser(): void {
    this.playSample(SOUND_ASSETS.glass, 0.13);
  }

  public playEpicFanfare(): void {
    this.playSample(SOUND_ASSETS.glass, 0.16, true);
  }

  public playMythicFanfare(): void {
    this.playSample(SOUND_ASSETS.alignment, 0.17, true);
  }

  public playLevelUpFanfare(): void {
    this.playSample(SOUND_ASSETS.levelUp, 0.15, true);
  }

  public playNewBestFanfare(): void {
    this.playSample(SOUND_ASSETS.powerUp, 0.17, true);
  }

  public playSacrificeSound(): void {
    this.playSample(SOUND_ASSETS.sacrifice, 0.12, true);
  }
}

export const sound = new SoundFX();
