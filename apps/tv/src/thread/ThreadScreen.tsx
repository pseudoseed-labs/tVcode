import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  AVAILABLE_CONNECTION_STATE,
  presentConnectionState,
} from "@t3tools/client-runtime/connection";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type {
  ThreadPendingApproval,
  ThreadPendingUserInput,
} from "@t3tools/client-runtime/state/thread-requests";
import { EMPTY_ENVIRONMENT_THREAD_STATE } from "@t3tools/client-runtime/state/threads";
import type { ProviderApprovalDecision, RuntimeRequestId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { memo, useContext, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type { ThreadRef } from "../board/BoardScreen";
import { FocusButton } from "../components/FocusButton";
import { environmentCatalog, environmentThreads, threadEnvironment } from "../state/atoms";
import { colors, layout, space, type } from "../theme";
import {
  approvalChoices,
  initialDraft,
  optionValue,
  pendingDecision,
  type QuestionDraft,
  questionAnswer,
  questionAnswers,
  threadViewStatus,
  type ThreadViewStatus,
  toggleOption,
} from "./threadModel";
import { type TranscriptRow, transcriptRows } from "./transcript";

const TRANSCRIPT_LIMIT = 40;

const Row = memo(function Row({ row }: { readonly row: TranscriptRow }) {
  const [focused, setFocused] = useState(false);
  return (
    // Rows take focus so the remote can scroll the transcript.
    <Pressable
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[styles.row, focused && styles.rowFocused]}
    >
      {row.kind === "user" && <Text style={styles.rowLabel}>You</Text>}
      {row.kind === "command" ? (
        <>
          <Text style={[styles.mono, { color: row.failed ? colors.error : colors.foreground }]}>
            $ {row.text}
          </Text>
          {row.output !== "" && <Text style={[styles.mono, styles.output]}>{row.output}</Text>}
        </>
      ) : (
        <Text
          style={[
            styles.rowText,
            row.kind === "user" && styles.userText,
            row.kind === "note" && {
              color:
                row.tone === "error"
                  ? colors.error
                  : row.tone === "warning"
                    ? colors.warning
                    : colors.mutedForeground,
            },
          ]}
        >
          {row.text}
        </Text>
      )}
    </Pressable>
  );
});

function statusNotice(status: ThreadViewStatus): { text: string; error: boolean } | null {
  switch (status.kind) {
    case "live":
    case "loading":
      return null;
    case "reconnecting":
      return { text: "Updating… showing the last known state.", error: false };
    case "disconnected":
      return {
        text: `Not connected to T3 Code. Showing the last known state.${status.detail ? ` ${status.detail}` : ""}`,
        error: true,
      };
    case "failed":
      return { text: `Could not load this thread. ${status.detail}`, error: true };
    case "deleted":
      return { text: "This thread was deleted.", error: true };
  }
}

function ApprovalPanel(props: {
  readonly approval: ThreadPendingApproval;
  readonly canRespond: boolean;
  readonly responding: boolean;
  readonly onRespond: (decision: ProviderApprovalDecision) => void;
}) {
  const { approval } = props;
  const choices = approvalChoices(approval.options);
  const live = approval.responseCapability === "live";
  const preferred = choices.find((choice) => choice.tone === "primary") ?? choices[0];
  const warning = choices.find((choice) => choice.warning)?.warning;
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Approval needed</Text>
      <Text style={styles.panelBody} numberOfLines={10}>
        {approval.detail ?? approval.reason ?? approval.appName ?? approval.requestKind}
      </Text>
      {!live && (
        <Text style={styles.muted}>
          The agent process for this request is gone. Interrupt or restart the run in T3 Code.
        </Text>
      )}
      {warning !== undefined && <Text style={styles.warning}>{warning}</Text>}
      {choices.map((choice) => (
        <FocusButton
          key={choice.decision}
          label={choice.label}
          tone={choice.tone}
          preferredFocus={choice === preferred}
          disabled={!live || !props.canRespond || props.responding}
          onPress={() => props.onRespond(choice.decision)}
        />
      ))}
    </View>
  );
}

function QuestionPanel(props: {
  readonly input: ThreadPendingUserInput;
  readonly canRespond: boolean;
  readonly responding: boolean;
  readonly onSubmit: (answers: Record<string, string | string[]>) => void;
  readonly onDismiss: () => void;
}) {
  const { input } = props;
  const [index, setIndex] = useState(0);
  const [drafts, setDrafts] = useState<Readonly<Record<string, QuestionDraft>>>({});
  const [typing, setTyping] = useState(false);
  const question = input.questions[index];
  if (question === undefined) return null;
  const draft = drafts[question.id] ?? initialDraft(question);
  const live = input.responseCapability === "live";
  const disabled = !live || !props.canRespond || props.responding;
  const last = index === input.questions.length - 1;
  const answered = questionAnswer(question, draft) !== null;

  const update = (next: QuestionDraft) => {
    const all = { ...drafts, [question.id]: next };
    setDrafts(all);
    return all;
  };
  const advance = (all: Readonly<Record<string, QuestionDraft>>) => {
    if (!last) return setIndex(index + 1);
    const answers = questionAnswers(input.questions, all);
    if (answers !== null) return props.onSubmit(answers);
    const open = input.questions.findIndex(
      (entry) => questionAnswer(entry, all[entry.id] ?? initialDraft(entry)) === null,
    );
    setIndex(Math.max(open, 0));
  };

  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>
        {input.questions.length > 1
          ? `Question ${index + 1} of ${input.questions.length}`
          : "Question for you"}
      </Text>
      <Text style={styles.muted} numberOfLines={1}>
        {question.header}
      </Text>
      <Text style={styles.questionText} numberOfLines={8}>
        {question.question}
      </Text>
      {!live && (
        <Text style={styles.muted}>
          The agent process for this question is gone. Interrupt or restart the run in T3 Code.
        </Text>
      )}
      {question.multiSelect && <Text style={styles.muted}>Pick all that apply.</Text>}
      {question.options.map((option, optionIndex) => {
        const value = optionValue(option);
        return (
          <FocusButton
            key={value}
            label={option.label}
            {...(option.description === option.label ? {} : { detail: option.description })}
            {...(question.multiSelect ? { checked: draft.selected.includes(value) } : {})}
            preferredFocus={optionIndex === 0}
            disabled={disabled}
            onPress={() => {
              const all = update(toggleOption(question, draft, value));
              if (!question.multiSelect) advance(all);
            }}
          />
        );
      })}
      {question.allowCustomAnswer !== false && (
        <TextInput
          value={draft.custom}
          placeholder={question.options.length > 0 ? "Or type an answer" : "Type an answer"}
          placeholderTextColor={colors.mutedForeground}
          editable={!disabled}
          hasTVPreferredFocus={question.options.length === 0}
          returnKeyType={last ? "send" : "next"}
          onFocus={() => setTyping(true)}
          onBlur={() => setTyping(false)}
          onChangeText={(custom) => update({ selected: draft.selected, custom })}
          onSubmitEditing={() => {
            if (draft.custom.trim() !== "") advance(drafts);
          }}
          style={[styles.input, typing && styles.inputFocused]}
        />
      )}
      {(question.multiSelect || draft.custom.trim() !== "") && (
        <FocusButton
          label={last ? "Send" : "Next"}
          tone="primary"
          disabled={disabled || !answered}
          onPress={() => advance(drafts)}
        />
      )}
      {index > 0 && (
        <FocusButton label="Back" disabled={props.responding} onPress={() => setIndex(index - 1)} />
      )}
      {input.dismissible && (
        <FocusButton label="Dismiss" tone="danger" disabled={disabled} onPress={props.onDismiss} />
      )}
    </View>
  );
}

export function ThreadScreen({ thread }: { readonly thread: ThreadRef }) {
  const registry = useContext(RegistryContext);
  const result = useAtomValue(environmentThreads.stateAtom(thread.environmentId, thread.threadId));
  const connectionResult = useAtomValue(environmentCatalog.stateAtom(thread.environmentId));
  const state = Option.getOrElse(AsyncResult.value(result), () => EMPTY_ENVIRONMENT_THREAD_STATE);
  const projection = Option.getOrNull(state.data);
  const failure = AsyncResult.isFailure(result)
    ? "The thread stream stopped."
    : Option.getOrNull(state.error);
  const connection = Option.getOrElse(
    AsyncResult.value(connectionResult),
    () => AVAILABLE_CONNECTION_STATE,
  );
  const threadStatus = state.status;
  const hasData = projection !== null;
  const status = useMemo(
    () =>
      threadViewStatus({
        status: threadStatus,
        hasData,
        failure,
        connection: presentConnectionState(connection),
      }),
    [threadStatus, hasData, failure, connection],
  );
  const rows = useMemo(
    () => (projection === null ? [] : transcriptRows(projection, TRANSCRIPT_LIMIT)),
    [projection],
  );
  const pending = useMemo(
    () => (projection === null ? null : pendingDecision(projection)),
    [projection],
  );
  const [responding, setResponding] = useState<RuntimeRequestId | null>(null);
  const [responseError, setResponseError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const notice = statusNotice(status);

  const send = async (
    requestId: RuntimeRequestId,
    run: () => Promise<{ readonly _tag: string }>,
  ) => {
    setResponding(requestId);
    setResponseError(null);
    const outcome = await run();
    setResponding(null);
    if (outcome._tag === "Failure") setResponseError("The server did not accept that response.");
  };
  const respond = (requestId: RuntimeRequestId, decision: ProviderApprovalDecision) =>
    send(requestId, () =>
      runAtomCommand(registry, threadEnvironment.respondToApproval, {
        environmentId: thread.environmentId,
        input: { threadId: thread.threadId, requestId, decision },
      }),
    );
  const answer = (requestId: RuntimeRequestId, answers: Record<string, string | string[]>) =>
    send(requestId, () =>
      runAtomCommand(registry, threadEnvironment.respondToUserInput, {
        environmentId: thread.environmentId,
        input: { threadId: thread.threadId, requestId, answers },
      }),
    );
  const dismiss = (requestId: RuntimeRequestId) =>
    send(requestId, () =>
      runAtomCommand(registry, threadEnvironment.dismissUserInput, {
        environmentId: thread.environmentId,
        input: { threadId: thread.threadId, requestId },
      }),
    );

  return (
    <View style={styles.screen}>
      <View style={styles.transcript}>
        <Text style={styles.title} numberOfLines={1}>
          {projection?.thread.title ?? (status.kind === "deleted" ? "Thread deleted" : "Loading…")}
        </Text>
        {notice !== null && (
          <Text style={[styles.notice, notice.error && styles.noticeError]} numberOfLines={3}>
            {notice.text}
          </Text>
        )}
        <ScrollView
          ref={scrollRef}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
          contentContainerStyle={styles.transcriptBody}
        >
          {rows.length === 0 && status.kind === "loading" && (
            <Text style={styles.muted}>Loading thread…</Text>
          )}
          {rows.length === 0 && projection !== null && (
            <Text style={styles.muted}>No messages yet.</Text>
          )}
          {rows.map((row) => (
            <Row key={row.key} row={row} />
          ))}
        </ScrollView>
      </View>
      <View style={styles.side}>
        <ScrollView style={styles.sideScroll} contentContainerStyle={styles.sideBody}>
          {pending === null ? (
            projection !== null && <Text style={styles.muted}>Nothing waiting on you.</Text>
          ) : pending.kind === "approval" ? (
            <ApprovalPanel
              approval={pending.approval}
              canRespond={status.kind === "live"}
              responding={responding !== null}
              onRespond={(decision) => void respond(pending.approval.requestId, decision)}
            />
          ) : (
            <QuestionPanel
              key={pending.input.requestId}
              input={pending.input}
              canRespond={status.kind === "live"}
              responding={responding !== null}
              onSubmit={(answers) => void answer(pending.input.requestId, answers)}
              onDismiss={() => void dismiss(pending.input.requestId)}
            />
          )}
          {pending !== null && status.kind !== "live" && (
            <Text style={styles.muted}>Decisions are off until the thread is live again.</Text>
          )}
          {responseError !== null && <Text style={styles.error}>{responseError}</Text>}
        </ScrollView>
        <Text style={styles.hint}>Press Menu to go back</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: colors.background,
    paddingHorizontal: space.safeX,
    paddingVertical: space.safeY,
    gap: space.lg,
  },
  transcript: { flex: 1 },
  title: {
    color: colors.foreground,
    fontSize: type.title,
    fontWeight: "700",
    marginBottom: space.md,
  },
  transcriptBody: { gap: space.sm, paddingBottom: space.xl },
  row: { padding: space.sm, borderRadius: 14, borderWidth: 2, borderColor: "transparent" },
  rowFocused: { backgroundColor: colors.card, borderColor: colors.border },
  rowLabel: { color: colors.mutedForeground, fontSize: type.caption, marginBottom: 4 },
  rowText: { color: colors.foreground, fontSize: type.body, lineHeight: type.body * 1.35 },
  userText: { color: colors.info },
  mono: { fontFamily: type.mono, fontSize: type.caption, lineHeight: type.caption * 1.4 },
  output: { color: colors.mutedForeground, marginTop: 4 },
  side: { width: layout.sideColumnWidth, gap: space.md, paddingTop: type.title + space.md },
  sideScroll: { flexGrow: 0 },
  sideBody: { gap: space.md, padding: 6 },
  notice: { color: colors.mutedForeground, fontSize: type.callout, marginBottom: space.sm },
  noticeError: { color: colors.error },
  panel: {
    backgroundColor: colors.card,
    borderColor: colors.warning,
    borderWidth: 2,
    borderRadius: 20,
    padding: space.md,
    gap: space.md,
  },
  panelTitle: { color: colors.warning, fontSize: type.headline, fontWeight: "700" },
  panelBody: { color: colors.foreground, fontSize: type.callout, fontFamily: type.mono },
  questionText: { color: colors.foreground, fontSize: type.callout },
  input: {
    color: colors.foreground,
    fontSize: type.body,
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 3,
    borderRadius: 16,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  inputFocused: { borderColor: colors.foreground },
  muted: { color: colors.mutedForeground, fontSize: type.body },
  warning: { color: colors.warning, fontSize: type.caption },
  error: { color: colors.error, fontSize: type.callout },
  hint: { color: colors.mutedForeground, fontSize: type.caption, marginTop: "auto" },
});
