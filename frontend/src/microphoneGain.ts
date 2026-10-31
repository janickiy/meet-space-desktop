import { volumePercent } from "./prejoinDevices";

/** Owns the outgoing processed track, never the hardware track or a speaker output. */
export class MicrophoneGain {
  readonly track: MediaStreamTrack;
  private context: AudioContext;
  private source: MediaStreamAudioSourceNode;
  private gain: GainNode;
  private destination: MediaStreamAudioDestinationNode;
  private closed = false;
  constructor(
    private input: MediaStreamTrack,
    volume: number,
  ) {
    this.context = new AudioContext();
    this.source = this.context.createMediaStreamSource(
      new MediaStream([input]),
    );
    this.gain = this.context.createGain();
    this.destination = this.context.createMediaStreamDestination();
    this.track = this.destination.stream.getAudioTracks()[0];
    this.setVolume(volume);
    this.source.connect(this.gain).connect(this.destination);
    input.addEventListener("ended", this.dispose);
  }
  async ready() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.context.resume(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("microphone_audio_context_timeout")),
            5000,
          );
        }),
      ]);
      if (
        this.closed ||
        this.input.readyState !== "live" ||
        this.context.state !== "running"
      )
        throw new Error("microphone_audio_context_unavailable");
    } catch (error) {
      this.dispose();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  setVolume(volume: number) {
    if (!this.closed) this.gain.gain.value = volumePercent(volume) / 100;
  }
  dispose = () => {
    if (this.closed) return;
    this.closed = true;
    this.input.removeEventListener("ended", this.dispose);
    this.track.stop();
    this.source.disconnect();
    this.gain.disconnect();
    this.destination.disconnect();
    void this.context.close().catch(() => {});
  };
}
