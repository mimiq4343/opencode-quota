/** @jsxImportSource solid-js */
import type { Context } from "@opencode/plugin/gui";
import { Show } from "solid-js";
import type { QuotaSnapshot } from "../core/types.js";
import type { GuiQuotaFailure } from "./bridge.js";

export function RemoteStatus(props: {
  ctx: Context;
  failure: () => GuiQuotaFailure | undefined;
  snapshot: () => QuotaSnapshot | undefined;
}) {
  const message = () => {
    const failure = props.failure();
    if (!failure) return "";
    return failure.kind === "unavailable"
      ? props.ctx.t("window.unavailable")
      : props.ctx.t("window.error", { message: failure.message });
  };
  const timestamp = () => {
    const snapshot = props.snapshot();
    return snapshot
      ? props.ctx.t("remote.stale", { time: new Date(snapshot.generatedAtMs).toLocaleString() })
      : props.ctx.t("remote.noSnapshot");
  };
  return (
    <Show when={props.failure()}>
      <div class="oq-remote-state" role="status" aria-live="polite">
        <strong>{props.ctx.t("remote.offline")}</strong>
        <span>{message()}</span>
        <span>{timestamp()}</span>
      </div>
    </Show>
  );
}
