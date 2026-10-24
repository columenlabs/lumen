/** An Analytics Engine dataset binding: what every Lumen meter writes its points to. */
export interface PointSink {
  writeDataPoint(p: { indexes?: string[]; blobs?: string[]; doubles?: number[] }): void;
}
