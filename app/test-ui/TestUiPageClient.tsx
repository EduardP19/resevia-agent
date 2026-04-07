"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

type TestMessage = {
  role: "user" | "assistant" | "waiting";
  content?: string;
  sessionId?: string;
  id?: string;
};

type ReviewMessage = {
  id: string;
  role: "user" | "assistant" | "draft";
  content: string;
  created_at: string;
};

type DraftMessage = {
  id: string;
  role: "draft";
  content: string;
  created_at: string;
};

type SendResponse = {
  reply?: string;
  draft?: boolean;
  status?: string;
  sessionId?: string;
  error?: string;
  approvalMode?: boolean;
};

type PollMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

type PollResponse = {
  messages?: PollMessage[];
  hasDraft?: boolean;
  status?: string;
  draft?: DraftMessage | null;
  reviewMessages?: ReviewMessage[];
  error?: string;
};

const TEST_UI_SESSION_KEY = "resevia_test_ui_session";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function trimReviewFeed(messages: ReviewMessage[]) {
  return messages.slice(-10);
}

function formatTime(value?: string) {
  if (!value) {
    return "--:--";
  }

  return new Date(value).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function IconRefresh() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-4 w-4">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.9"
        d="M4 4v5h5M20 20v-5h-5M19.4 9A8 8 0 0 0 5.2 7.8M4.6 15A8 8 0 0 0 18.8 16.2"
      />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-4 w-4">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="m5 12 4 4L19 6"
      />
    </svg>
  );
}

function IconAlert() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="mt-0.5 h-4 w-4 shrink-0">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.9"
        d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
      />
    </svg>
  );
}

export default function TestUiPageClient() {
  const customerScrollRef = useRef<HTMLDivElement>(null);
  const reviewScrollRef = useRef<HTMLDivElement>(null);
  const isSyncingRef = useRef(false);
  const lastSyncedAt = useRef<string | null>(null);
  const seenIds = useRef<Set<string>>(new Set());
  const hadDraftRef = useRef(false);
  const currentDraftIdRef = useRef<string | null>(null);

  const [messages, setMessages] = useState<TestMessage[]>([]);
  const [reviewFeed, setReviewFeed] = useState<ReviewMessage[]>([]);
  const [reviewDraft, setReviewDraft] = useState<DraftMessage | null>(null);
  const [reviewComposer, setReviewComposer] = useState("");
  const [draftStatus, setDraftStatus] = useState("No draft yet.");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [manualApproval, setManualApproval] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const hasWaiting = messages.some((message) => message.role === "waiting");
  const customerComposerLocked = manualApproval && Boolean(reviewDraft);
  const toggleDisabled = Boolean(reviewDraft) || loading || isApproving;
  const modeLabel = manualApproval ? "Manual" : "Auto";
  const draftReady = Boolean(reviewDraft && reviewComposer.trim());

  const applyReviewSnapshot = useCallback((data: PollResponse) => {
    setReviewFeed(data.reviewMessages || []);

    const nextDraft = data.draft || null;
    if (currentDraftIdRef.current !== nextDraft?.id) {
      setReviewComposer(nextDraft?.content || "");
      currentDraftIdRef.current = nextDraft?.id || null;
    }

    if (!nextDraft) {
      currentDraftIdRef.current = null;
    }

    if (nextDraft) {
      setDraftStatus("Draft ready for approval.");
    }

    setReviewDraft(nextDraft);
  }, []);

  const resetSession = useCallback(() => {
    setSessionId(null);
    sessionStorage.removeItem(TEST_UI_SESSION_KEY);
    setMessages([]);
    setReviewFeed([]);
    setReviewDraft(null);
    setReviewComposer("");
    setDraftStatus("No draft yet.");
    setInput("");
    setError(null);
    setReviewError(null);
    lastSyncedAt.current = null;
    seenIds.current = new Set();
    hadDraftRef.current = false;
    currentDraftIdRef.current = null;
  }, []);

  useEffect(() => {
    const savedManualApproval = localStorage.getItem("resevia_test_ui_manual_approval");
    const savedSessionId = sessionStorage.getItem(TEST_UI_SESSION_KEY);

    if (savedSessionId) {
      setSessionId(savedSessionId);
    }

    if (savedManualApproval) {
      setManualApproval(savedManualApproval === "true");
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("resevia_test_ui_manual_approval", String(manualApproval));
  }, [manualApproval]);

  useEffect(() => {
    customerScrollRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    reviewScrollRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, reviewFeed, reviewDraft, loading, isApproving]);

  const syncTranscript = useCallback(
    async (nextSessionId: string) => {
      if (isSyncingRef.current) {
        return;
      }

      isSyncingRef.current = true;

      try {
        const query = new URLSearchParams({
          sessionId: nextSessionId,
          t: String(Date.now()),
        });

        if (lastSyncedAt.current) {
          query.set("since", lastSyncedAt.current);
        }

        const response = await fetch(`/api/test-ui/poll?${query.toString()}`, {
          cache: "no-store",
        });
        const data = (await response.json()) as PollResponse;

        if (!response.ok) {
          throw new Error(data.error || "Unable to sync transcript.");
        }

        applyReviewSnapshot(data);

        const hasDraftNow = Boolean(data.hasDraft);
        if (hadDraftRef.current && !hasDraftNow && lastSyncedAt.current) {
          lastSyncedAt.current = new Date(
            new Date(lastSyncedAt.current).getTime() - 5000
          ).toISOString();
        }
        hadDraftRef.current = hasDraftNow;

        const newPollMessages = data.messages || [];
        const unprocessed = newPollMessages.filter((message) => !seenIds.current.has(message.id));

        unprocessed.forEach((message) => seenIds.current.add(message.id));

        if (newPollMessages.length > 0) {
          lastSyncedAt.current = newPollMessages[newPollMessages.length - 1].created_at;
        }

        setMessages((currentMessages) => {
          let nextMessages = [...currentMessages];
          let changed = false;

          for (const message of unprocessed) {
            changed = true;

            if (message.role === "assistant") {
              const waitingIndex = nextMessages.findIndex((entry) => entry.role === "waiting");
              const localAssistantIndex = nextMessages.findIndex(
                (entry) =>
                  entry.role === "assistant" &&
                  entry.content === message.content &&
                  (!entry.id || entry.id.startsWith("local-assistant-"))
              );

              if (waitingIndex !== -1) {
                nextMessages[waitingIndex] = {
                  role: "assistant",
                  content: message.content,
                  id: message.id,
                };
              } else if (localAssistantIndex !== -1) {
                nextMessages[localAssistantIndex] = {
                  role: "assistant",
                  content: message.content,
                  id: message.id,
                };
              } else {
                nextMessages.push({
                  role: "assistant",
                  content: message.content,
                  id: message.id,
                });
              }
            }

            if (message.role === "user") {
              const localMatchIndex = nextMessages.findIndex(
                (entry) =>
                  entry.role === "user" &&
                  entry.content === message.content &&
                  (!entry.id || entry.id.startsWith("local-user-"))
              );

              if (localMatchIndex !== -1) {
                nextMessages[localMatchIndex] = {
                  role: "user",
                  content: message.content,
                  id: message.id,
                };
              } else {
                nextMessages.push({
                  role: "user",
                  content: message.content,
                  id: message.id,
                });
              }
            }
          }

          const justGotAssistant = unprocessed.some((message) => message.role === "assistant");
          const currentlyHasWaiting = nextMessages.some((message) => message.role === "waiting");

          if (data.hasDraft && !currentlyHasWaiting && !justGotAssistant) {
            nextMessages.push({ role: "waiting", sessionId: nextSessionId });
            changed = true;
          } else if (!data.hasDraft && currentlyHasWaiting) {
            nextMessages = nextMessages.filter((message) => message.role !== "waiting");
            changed = true;
          }

          return changed ? nextMessages : currentMessages;
        });
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Unable to sync transcript.");
      } finally {
        isSyncingRef.current = false;
      }
    },
    [applyReviewSnapshot]
  );

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    void syncTranscript(sessionId);

    const interval = window.setInterval(() => {
      void syncTranscript(sessionId);
    }, hasWaiting || reviewDraft ? 1500 : 3000);

    return () => {
      window.clearInterval(interval);
    };
  }, [hasWaiting, reviewDraft, sessionId, syncTranscript]);

  const handleManualApprovalToggle = useCallback(() => {
    if (toggleDisabled) {
      return;
    }

    setManualApproval((current) => !current);
    setReviewError(null);
    setDraftStatus("No draft yet.");
  }, [toggleDisabled]);

  const handleRefreshDraft = useCallback(() => {
    if (reviewDraft) {
      setReviewComposer(reviewDraft.content);
      setDraftStatus("Draft refreshed.");
    }

    if (sessionId) {
      void syncTranscript(sessionId);
    }
  }, [reviewDraft, sessionId, syncTranscript]);

  const sendMessage = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();

      if (!input.trim() || loading || customerComposerLocked) {
        return;
      }

      const text = input.trim();
      const now = new Date().toISOString();
      const tempId = `local-user-${Date.now()}`;

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          role: "user",
          content: text,
          id: tempId,
        },
      ]);
      setReviewFeed((currentMessages) =>
        trimReviewFeed([
          ...currentMessages,
          {
            id: tempId,
            role: "user",
            content: text,
            created_at: now,
          },
        ])
      );
      setInput("");
      setLoading(true);
      setError(null);
      setReviewError(null);
      setDraftStatus(
        manualApproval ? "Sophia is drafting a reply..." : "Sophia is sending the reply..."
      );

      try {
        const response = await fetch("/api/test-ui/message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            id: sessionId,
            manualApproval,
          }),
        });
        const data = (await response.json()) as SendResponse;

        if (!response.ok) {
          throw new Error(data.error || "Unable to send the message.");
        }

        const resolvedSessionId = data.sessionId || sessionId || null;

        if (resolvedSessionId && resolvedSessionId !== sessionId) {
          setSessionId(resolvedSessionId);
          sessionStorage.setItem(TEST_UI_SESSION_KEY, resolvedSessionId);
          lastSyncedAt.current = null;
          seenIds.current = new Set();
          hadDraftRef.current = false;
        }

        if (data.draft) {
          const localDraftId = `local-draft-${Date.now()}`;
          const localDraft: DraftMessage = {
            id: localDraftId,
            role: "draft",
            content: data.reply || "",
            created_at: new Date().toISOString(),
          };

          currentDraftIdRef.current = localDraftId;
          setReviewDraft(localDraft);
          setReviewComposer(localDraft.content);
          setDraftStatus("Draft ready for approval.");
          setReviewFeed((currentMessages) =>
            trimReviewFeed([
              ...currentMessages.filter((message) => message.role !== "draft"),
              localDraft,
            ])
          );
          setMessages((currentMessages) => {
            if (currentMessages.some((message) => message.role === "waiting")) {
              return currentMessages;
            }

            return [
              ...currentMessages,
              {
                role: "waiting",
                sessionId: resolvedSessionId || undefined,
              },
            ];
          });

          if (resolvedSessionId) {
            void syncTranscript(resolvedSessionId);
          }

          return;
        }

        if (data.reply) {
          const localAssistantId = `local-assistant-${Date.now()}`;
          const assistantMessage: ReviewMessage = {
            id: localAssistantId,
            role: "assistant",
            content: data.reply,
            created_at: new Date().toISOString(),
          };

          setReviewDraft(null);
          setReviewComposer(data.reply);
          currentDraftIdRef.current = null;
          hadDraftRef.current = false;
          setDraftStatus("Auto-sent.");
          setReviewFeed((currentMessages) => trimReviewFeed([...currentMessages, assistantMessage]));
          setMessages((currentMessages) => {
            const waitingIndex = currentMessages.findIndex(
              (message) => message.role === "waiting"
            );

            if (waitingIndex !== -1) {
              const nextMessages = [...currentMessages];
              nextMessages[waitingIndex] = {
                role: "assistant",
                content: data.reply,
                id: localAssistantId,
              };
              return nextMessages;
            }

            return [
              ...currentMessages,
              {
                role: "assistant",
                content: data.reply,
                id: localAssistantId,
              },
            ];
          });
        }
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Unable to send the message.");
        setDraftStatus("Unable to generate a reply.");
      } finally {
        setLoading(false);
      }
    },
    [customerComposerLocked, input, loading, manualApproval, sessionId, syncTranscript]
  );

  const handleApprove = useCallback(async () => {
    if (!sessionId || !reviewDraft || !reviewComposer.trim() || isApproving) {
      return;
    }

    const approvedContent = reviewComposer.trim();
    const localAssistantId = `local-assistant-${Date.now()}`;

    setIsApproving(true);
    setReviewError(null);
    setError(null);

    try {
      const response = await fetch("/api/test-ui/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          content: approvedContent,
        }),
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "Unable to approve the draft.");
      }

      setMessages((currentMessages) => {
        const waitingIndex = currentMessages.findIndex((message) => message.role === "waiting");

        if (waitingIndex !== -1) {
          const nextMessages = [...currentMessages];
          nextMessages[waitingIndex] = {
            role: "assistant",
            content: approvedContent,
            id: localAssistantId,
          };
          return nextMessages;
        }

        return [
          ...currentMessages,
          {
            role: "assistant",
            content: approvedContent,
            id: localAssistantId,
          },
        ];
      });
      setReviewFeed((currentMessages) =>
        trimReviewFeed([
          ...currentMessages.filter((message) => message.role !== "draft"),
          {
            id: localAssistantId,
            role: "assistant",
            content: approvedContent,
            created_at: new Date().toISOString(),
          },
        ])
      );
      setReviewDraft(null);
      setReviewComposer(approvedContent);
      setDraftStatus("Approved and sent.");
      currentDraftIdRef.current = null;
      hadDraftRef.current = false;

      await syncTranscript(sessionId);
    } catch (nextError) {
      setReviewError(
        nextError instanceof Error ? nextError.message : "Unable to approve the draft."
      );
      setDraftStatus("Unable to approve the draft.");
    } finally {
      setIsApproving(false);
    }
  }, [isApproving, reviewComposer, reviewDraft, sessionId, syncTranscript]);

  const reviewStatusTone = loading && manualApproval
    ? "bg-[#c9a96e]"
    : draftReady
      ? "bg-emerald-400"
      : manualApproval
        ? "bg-white/30"
        : "bg-sky-400";

  return (
    <section className="relative min-h-[100dvh] overflow-hidden bg-[#0b0911] px-4 pb-16 pt-20 text-white sm:px-6 sm:pt-24">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(201,169,110,0.16),transparent_28%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_bottom_right,rgba(109,40,217,0.18),transparent_34%)]" />
      <div className="relative mx-auto max-w-7xl">
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#b94747]/35 bg-[#b94747]/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-[#f4d6d6]">
            <span className="h-2.5 w-2.5 rounded-full bg-[#e14a4a]" />
            Two-sided demo harness
          </div>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            Show both sides before a business goes live
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-white/68 sm:text-lg">
            Send messages as the customer, then review and approve Sophia&apos;s reply in the
            salon panel. Toggle manual approval off to see the fully autonomous flow.
          </p>
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-2 lg:items-start">
          <div className="rounded-[2rem] border border-[#c9a96e]/30 bg-[linear-gradient(180deg,rgba(244,231,204,0.96),rgba(232,209,166,0.9))] p-6 text-[#271c0f] shadow-[0_24px_90px_rgba(201,169,110,0.18)]">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/60 text-xl shadow-[0_12px_30px_rgba(39,28,15,0.08)]">
                  💬
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#8c6331]">
                    Customer screen
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold text-[#22170d]">Client conversation</h2>
                  <p className="mt-1 text-sm text-[#5f4630]">What the customer sees</p>
                </div>
              </div>
            </div>

            <div className="mt-6 border-t border-[#8c6331]/15 pt-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8c6331]">
                Live transcript
              </p>

              <div className="mt-3 min-h-[220px] max-h-[340px] space-y-3 overflow-y-auto rounded-[1.5rem] border border-[#8c6331]/15 bg-white/55 p-4">
                {messages.length === 0 ? (
                  <div className="flex min-h-[180px] items-center justify-center rounded-[1.2rem] border border-dashed border-[#8c6331]/20 bg-white/35 px-6 text-center text-sm text-[#6b4c2c]">
                    No messages yet.
                  </div>
                ) : (
                  messages.map((message, index) => {
                    const isAssistant = message.role === "assistant";
                    const isWaiting = message.role === "waiting";

                    return (
                      <div
                        key={message.id || `${message.role}-${index}`}
                        className={cx(
                          "flex",
                          isAssistant || isWaiting ? "justify-start" : "justify-end"
                        )}
                      >
                        {isWaiting ? (
                          <div className="inline-flex items-center gap-3 rounded-[1.25rem] border border-[#8c6331]/18 bg-white/70 px-4 py-3 text-sm text-[#5a432a]">
                            <div className="flex items-center gap-1.5">
                              <span
                                className="h-2 w-2 animate-bounce rounded-full bg-[#c9a96e]"
                                style={{ animationDelay: "0ms" }}
                              />
                              <span
                                className="h-2 w-2 animate-bounce rounded-full bg-[#c9a96e]"
                                style={{ animationDelay: "120ms" }}
                              />
                              <span
                                className="h-2 w-2 animate-bounce rounded-full bg-[#c9a96e]"
                                style={{ animationDelay: "240ms" }}
                              />
                            </div>
                            Sophia is waiting for approval.
                          </div>
                        ) : (
                          <div
                            className={cx(
                              "max-w-[86%] rounded-[1.3rem] px-4 py-3 text-sm leading-6 shadow-[0_10px_24px_rgba(39,28,15,0.08)]",
                              isAssistant
                                ? "rounded-bl-md border border-white/70 bg-white text-[#2e2318]"
                                : "rounded-br-md bg-[#b78743] text-white"
                            )}
                          >
                            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-current/65">
                              {isAssistant ? "Sophia" : "Customer"}
                            </p>
                            <p className="whitespace-pre-wrap">{message.content}</p>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}

                {loading && !manualApproval ? (
                  <div className="flex justify-start">
                    <div className="inline-flex items-center gap-2 rounded-[1.25rem] border border-white/65 bg-white/80 px-4 py-3 text-sm text-[#5a432a]">
                      <span className="h-2 w-2 animate-bounce rounded-full bg-[#b78743]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-[#b78743]" style={{ animationDelay: "120ms" }} />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-[#b78743]" style={{ animationDelay: "240ms" }} />
                    </div>
                  </div>
                ) : null}

                <div ref={customerScrollRef} />
              </div>
            </div>

            {error ? (
              <div className="mt-4 flex items-start gap-3 rounded-[1.2rem] border border-rose-500/20 bg-rose-500/12 px-4 py-3 text-sm text-rose-950">
                <IconAlert />
                <p>{error}</p>
              </div>
            ) : null}

            <form className="mt-5" onSubmit={sendMessage}>
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder={
                  customerComposerLocked
                    ? "Approve Sophia's draft before sending the next message."
                    : "Write as the customer..."
                }
                disabled={loading || isApproving || customerComposerLocked}
                rows={4}
                className="min-h-[132px] w-full rounded-[1.5rem] border border-[#8c6331]/18 bg-white/65 px-4 py-4 text-sm leading-6 text-[#24180e] placeholder:text-[#7c5f44] focus:border-[#b78743] focus:outline-none focus:ring-2 focus:ring-[#b78743]/25 disabled:cursor-not-allowed disabled:opacity-60"
              />

              <div className="mt-4 flex items-center justify-end">
                <button
                  type="submit"
                  disabled={!input.trim() || loading || isApproving || customerComposerLocked}
                  className="inline-flex items-center justify-center rounded-full bg-[#22170d] px-5 py-3 text-sm font-semibold text-[#f4e7cc] transition hover:bg-[#110b06] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Send ↗
                </button>
              </div>
            </form>
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(25,21,38,0.95),rgba(18,15,28,0.96))] p-6 text-white shadow-[0_24px_90px_rgba(0,0,0,0.26)]">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-xl">
                  🛡️
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/48">
                    Salon screen
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold text-white">Approval cockpit</h2>
                  <p className="mt-1 text-sm text-white/60">What the salon owner sees</p>
                </div>
              </div>

              <span
                className={cx(
                  "inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em]",
                  manualApproval
                    ? "bg-emerald-500/15 text-emerald-200"
                    : "bg-sky-500/15 text-sky-200"
                )}
              >
                {modeLabel}
              </span>
            </div>

            <div className="mt-6 flex items-center justify-between gap-4 border-t border-white/10 pt-5">
              <div>
                <p className="text-sm font-semibold text-white">Manual approval</p>
                <p className="mt-1 text-sm text-white/55">Review each reply before it sends</p>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={manualApproval}
                onClick={handleManualApprovalToggle}
                disabled={toggleDisabled}
                className={cx(
                  "inline-flex h-8 w-14 items-center rounded-full border px-1 transition",
                  manualApproval
                    ? "border-emerald-400/40 bg-emerald-500/20"
                    : "border-sky-400/35 bg-sky-500/18",
                  toggleDisabled && "cursor-not-allowed opacity-50"
                )}
              >
                <span
                  className={cx(
                    "h-6 w-6 rounded-full bg-white transition",
                    manualApproval ? "translate-x-0" : "translate-x-6"
                  )}
                />
              </button>
            </div>

            <div className="mt-5 border-t border-white/10 pt-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/45">
                  Review timeline
                </p>
              </div>

              <div className="mt-3 max-h-[240px] space-y-3 overflow-y-auto rounded-[1.4rem] border border-white/10 bg-black/15 p-3">
                {reviewFeed.length === 0 ? (
                  <div className="flex min-h-[180px] items-center justify-center rounded-[1.15rem] border border-dashed border-white/10 bg-white/[0.03] px-6 text-center text-sm text-white/45">
                    No messages yet.
                  </div>
                ) : (
                  reviewFeed.map((message) => {
                    const isUser = message.role === "user";
                    const isDraft = message.role === "draft";

                    return (
                      <div
                        key={message.id}
                        className={cx("flex", isUser ? "justify-end" : "justify-start")}
                      >
                        <div
                          className={cx(
                            "max-w-[88%] rounded-[1.15rem] border px-3 py-3 text-sm leading-6",
                            isUser
                              ? "border-[#b78743]/30 bg-[#b78743]/20 text-white"
                              : isDraft
                                ? "border-emerald-400/18 bg-emerald-400/10 text-emerald-50"
                                : "border-white/10 bg-white/[0.05] text-white"
                          )}
                        >
                          <div className="mb-2 flex items-center justify-between gap-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">
                            <span>{isUser ? "Customer" : isDraft ? "Sophia draft" : "Sophia"}</span>
                            <span>{formatTime(message.created_at)}</span>
                          </div>
                          <p className="whitespace-pre-wrap">{message.content}</p>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={reviewScrollRef} />
              </div>
            </div>

            <div className="mt-5 border-t border-white/10 pt-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/45">
                  Review composer
                </p>

                <button
                  type="button"
                  onClick={handleRefreshDraft}
                  disabled={loading || isApproving || (!reviewDraft && !sessionId)}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-2 text-sm font-medium text-white transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <IconRefresh />
                  Refresh
                </button>
              </div>

              <div className="mt-3 min-h-[180px] rounded-[1.4rem] border border-white/10 bg-[#0f0d17] p-4">
                {loading && manualApproval ? (
                  <div className="flex min-h-[148px] items-center justify-center">
                    <div className="inline-flex items-center gap-2 text-[#f0dfbf]">
                      <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-[#c9a96e]" />
                      <span
                        className="h-2.5 w-2.5 animate-bounce rounded-full bg-[#c9a96e]"
                        style={{ animationDelay: "120ms" }}
                      />
                      <span
                        className="h-2.5 w-2.5 animate-bounce rounded-full bg-[#c9a96e]"
                        style={{ animationDelay: "240ms" }}
                      />
                    </div>
                  </div>
                ) : (
                  <textarea
                    value={reviewComposer}
                    onChange={(event) => setReviewComposer(event.target.value)}
                    disabled={!reviewDraft || isApproving}
                    rows={6}
                    placeholder="No draft yet."
                    className="min-h-[148px] w-full resize-none bg-transparent text-sm leading-6 text-white placeholder:text-white/30 focus:outline-none disabled:cursor-not-allowed disabled:opacity-70"
                  />
                )}
              </div>

              <div className="mt-4 flex items-center gap-3 text-sm text-white/65">
                <span className={cx("h-2.5 w-2.5 rounded-full", reviewStatusTone)} />
                <span>{draftStatus}</span>
              </div>

              <button
                type="button"
                onClick={() => void handleApprove()}
                disabled={!draftReady || isApproving}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-[1.1rem] bg-[#c9a96e] px-5 py-3.5 text-sm font-semibold text-[#1d1711] shadow-[0_18px_35px_rgba(201,169,110,0.24)] transition hover:bg-[#d6ba84] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isApproving ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#1d1711]/20 border-t-[#1d1711]" />
                ) : (
                  <IconCheck />
                )}
                {isApproving ? "Sending..." : "Approve and send"}
              </button>

              {reviewError ? (
                <div className="mt-4 flex items-start gap-3 rounded-[1.2rem] border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                  <IconAlert />
                  <p>{reviewError}</p>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {(messages.length > 0 || reviewFeed.length > 0 || sessionId) && !loading && !isApproving ? (
          <div className="mt-5 flex justify-center">
            <button
              type="button"
              onClick={resetSession}
              className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white/65 transition hover:bg-white/[0.07] hover:text-white"
            >
              Start a fresh demo
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
