import {
  DEFAULT_BGM_ID,
  SFX_ASSETS,
  getBgmAsset,
  isBgmAssetId,
  type BgmAssetId,
  type SfxAssetId
} from './AudioAssets';

export interface GameAudio {
  getSelectedBgmId(): BgmAssetId;
  isMuted(): boolean;
  selectBgm(id: BgmAssetId): void;
  toggleMute(): boolean;
  startBgm(): void;
  stopBgm(): void;
  pauseBgm(): void;
  resumeBgm(): void;
  playSfx(id: SfxAssetId): void;
  dispose(): void;
}

export class AudioManager implements GameAudio {
  private selectedBgmId: BgmAssetId = DEFAULT_BGM_ID;
  private bgmAudio: HTMLAudioElement | null = null;
  private bgmPausedByGame = false;
  private muted = false;

  public getSelectedBgmId(): BgmAssetId {
    return this.selectedBgmId;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public selectBgm(id: BgmAssetId): void {
    if (!isBgmAssetId(id) || id === this.selectedBgmId) {
      return;
    }

    const wasPlaying = this.bgmAudio !== null && !this.bgmAudio.paused;
    this.stopBgm();
    this.selectedBgmId = id;
    if (wasPlaying) {
      this.startBgm();
    }
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.bgmAudio) {
      this.bgmAudio.muted = this.muted;
    }
    return this.muted;
  }

  public startBgm(): void {
    const audio = this.getOrCreateBgmAudio();
    if (!audio) {
      return;
    }

    audio.loop = true;
    audio.muted = this.muted;
    if (audio.paused) {
      audio.currentTime = 0;
    }
    this.bgmPausedByGame = false;
    this.playAudio(audio);
  }

  public stopBgm(): void {
    if (!this.bgmAudio) {
      return;
    }

    this.bgmAudio.pause();
    try {
      this.bgmAudio.currentTime = 0;
    } catch {
      // Some browser states disallow seeking. Stopping playback is still enough.
    }
    this.bgmPausedByGame = false;
  }

  public pauseBgm(): void {
    if (!this.bgmAudio || this.bgmAudio.paused) {
      return;
    }
    this.bgmAudio.pause();
    this.bgmPausedByGame = true;
  }

  public resumeBgm(): void {
    if (!this.bgmPausedByGame || !this.bgmAudio) {
      return;
    }
    this.bgmPausedByGame = false;
    this.playAudio(this.bgmAudio);
  }

  public playSfx(id: SfxAssetId): void {
    if (this.muted) {
      return;
    }

    const asset = SFX_ASSETS[id];
    const audio = this.createAudioElement(asset.src);
    if (!audio) {
      return;
    }

    audio.volume = asset.volume;
    audio.preload = 'auto';
    this.playAudio(audio);
  }

  public dispose(): void {
    this.stopBgm();
    this.bgmAudio = null;
  }

  private getOrCreateBgmAudio(): HTMLAudioElement | null {
    const asset = getBgmAsset(this.selectedBgmId);
    if (this.bgmAudio?.dataset.assetId === asset.id) {
      this.bgmAudio.volume = asset.volume;
      return this.bgmAudio;
    }

    this.bgmAudio = this.createAudioElement(asset.src);
    if (!this.bgmAudio) {
      return null;
    }

    this.bgmAudio.dataset.assetId = asset.id;
    this.bgmAudio.volume = asset.volume;
    this.bgmAudio.muted = this.muted;
    this.bgmAudio.preload = 'auto';
    return this.bgmAudio;
  }

  private createAudioElement(src: string): HTMLAudioElement | null {
    if (typeof Audio === 'undefined') {
      return null;
    }

    return new Audio(src);
  }

  private playAudio(audio: HTMLAudioElement): void {
    try {
      const playResult = audio.play();
      if (typeof playResult?.catch === 'function') {
        void playResult.catch(() => undefined);
      }
    } catch {
      // Browsers can reject autoplay until the first user gesture.
    }
  }
}
