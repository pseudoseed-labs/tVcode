import * as Schema from "effect/Schema";
import { IsoDateTime } from "./baseSchemas.ts";

export const TvDoorbellRingReason = Schema.Literals(["needs-you", "completed", "failed", "test"]);
export type TvDoorbellRingReason = typeof TvDoorbellRingReason.Type;

export const TvDoorbellRing = Schema.Struct({
  at: IsoDateTime,
  reason: TvDoorbellRingReason,
  threadTitle: Schema.String,
});
export type TvDoorbellRing = typeof TvDoorbellRing.Type;

export const TvDoorbellStatus = Schema.Struct({
  /** off: setting disabled. unavailable: enabled but this host cannot run it (see message). */
  state: Schema.Literals(["off", "starting", "ready", "unavailable"]),
  paired: Schema.Boolean,
  accessoryName: Schema.String,
  /** Eight-digit HomeKit setup code. Null until the accessory has an identity. */
  setupCode: Schema.NullOr(Schema.String),
  /** `X-HM://` payload the Home app scans as a QR code. */
  setupUri: Schema.NullOr(Schema.String),
  lastRing: Schema.NullOr(TvDoorbellRing),
  message: Schema.NullOr(Schema.String),
});
export type TvDoorbellStatus = typeof TvDoorbellStatus.Type;

export class TvDoorbellError extends Schema.TaggedError<TvDoorbellError>()("TvDoorbellError", {
  message: Schema.String,
}) {}
