"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Logo from "../(dashboard)/Logo";

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

const TEST_UI_SESSION_KEY = "resevia_sophia_sandbox_session";
const SESSION_WARNING_MS = 2 * 60 * 1000;
const SESSION_EXPIRY_MS = 3 * 60 * 1000;
const SESSION_WARNING_SECONDS = Math.ceil((SESSION_EXPIRY_MS - SESSION_WARNING_MS) / 1000);

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
  const customerTranscriptRef = useRef<HTMLDivElement>(null);
  const reviewTranscriptRef = useRef<HTMLDivElement>(null);
  const reviewComposerRef = useRef<HTMLTextAreaElement>(null);
  const customerAutoScrollRef = useRef(true);
  const reviewAutoScrollRef = useRef(true);
  const isSyncingRef = useRef(false);
  const isExpiringRef = useRef(false);
  const lastSyncedAt = useRef<string | null>(null);
  const seenIds = useRef<Set<string>>(new Set());
  const hadDraftRef = useRef(false);
  const currentDraftIdRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const warningTimeoutRef = useRef<number | null>(null);
  const expiryTimeoutRef = useRef<number | null>(null);
  const countdownIntervalRef = useRef<number | null>(null);

  const [messages, setMessages] = useState<TestMessage[]>([]);
  const [reviewFeed, setReviewFeed] = useState<ReviewMessage[]>([]);
  const [reviewDraft, setReviewDraft] = useState<DraftMessage | null>(null);
  const [reviewComposer, setReviewComposer] = useState("");
  const [isModifyMode, setIsModifyMode] = useState(false);
  const [draftStatus, setDraftStatus] = useState("No draft yet");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [manualApproval, setManualApproval] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [showExpiryWarning, setShowExpiryWarning] = useState(false);
  const [secondsUntilExpiry, setSecondsUntilExpiry] = useState(SESSION_WARNING_SECONDS);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [mobileScreen, setMobileScreen] = useState<"customer" | "salon" | null>(null);

  const hasWaiting = messages.some((message) => message.role === "waiting");
  const customerComposerLocked = sessionExpired || (manualApproval && Boolean(reviewDraft));
  const toggleDisabled = sessionExpired || loading || isApproving;
  const draftReady = Boolean(reviewDraft && reviewComposer.trim());
  const toggleModeText = manualApproval ? "Manual Approval" : "Agent Autonomous";
  const salonNeedsAction =
    !sessionExpired && manualApproval && Boolean(reviewDraft) && !loading && !isApproving;
  const customerNeedsAction = !sessionExpired && !salonNeedsAction && !loading && !isApproving;
  const customerScreenDisabled = !customerNeedsAction;
  const salonScreenDisabled = !salonNeedsAction;
  const customerNeedsAttention = customerNeedsAction && !sessionExpired;
  const salonNeedsAttention = salonNeedsAction && !sessionExpired;
  const hasCustomerSentMessage = messages.some((message) => message.role === "user");

  const clearExpiryTimers = useCallback(() => {
    if (warningTimeoutRef.current) {
      window.clearTimeout(warningTimeoutRef.current);
      warningTimeoutRef.current = null;
    }

    if (expiryTimeoutRef.current) {
      window.clearTimeout(expiryTimeoutRef.current);
      expiryTimeoutRef.current = null;
    }

    if (countdownIntervalRef.current) {
      window.clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }, []);

  const closeSessionOnServer = useCallback(async (nextSessionId: string) => {
    try {
      const response = await fetch("/api/test-ui/expire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: nextSessionId }),
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "Unable to expire the demo session.");
      }
    } catch (nextError) {
      console.error("[Sophia Sandbox Session Expire Error]", nextError);
    }
  }, []);

  const resetLocalSession = useCallback(() => {
    sessionStorage.removeItem(TEST_UI_SESSION_KEY);
    sessionIdRef.current = null;
    setSessionId(null);
    setManualApproval(true);
    setMessages([]);
    setReviewFeed([]);
    setReviewDraft(null);
    setReviewComposer("");
    setIsModifyMode(false);
    setDraftStatus("No draft yet");
    setInput("");
    setError(null);
    setReviewError(null);
    setLoading(false);
    setIsApproving(false);
    setShowExpiryWarning(false);
    setSecondsUntilExpiry(SESSION_WARNING_SECONDS);
    setSessionExpired(false);
    lastSyncedAt.current = null;
    seenIds.current = new Set();
    hadDraftRef.current = false;
    currentDraftIdRef.current = null;
    isExpiringRef.current = false;
    clearExpiryTimers();
  }, [clearExpiryTimers]);

  const expireSessionLocally = useCallback(async () => {
    const activeSessionId = sessionIdRef.current;

    if (!activeSessionId || isExpiringRef.current) {
      return;
    }

    isExpiringRef.current = true;
    clearExpiryTimers();
    setLoading(false);
    setIsApproving(false);
    setShowExpiryWarning(false);
    setSecondsUntilExpiry(0);
    setSessionExpired(true);
    setDraftStatus("Session expired after 3 minutes of inactivity. Start a fresh demo.");
    setSessionId(null);
    sessionStorage.removeItem(TEST_UI_SESSION_KEY);
    setMessages((currentMessages) => currentMessages.filter((message) => message.role !== "waiting"));
    setReviewDraft(null);
    setReviewComposer("");
    setIsModifyMode(false);
    setReviewError(null);
    currentDraftIdRef.current = null;
    lastSyncedAt.current = null;
    seenIds.current = new Set();
    hadDraftRef.current = false;

    await closeSessionOnServer(activeSessionId);
    isExpiringRef.current = false;
  }, [clearExpiryTimers, closeSessionOnServer]);

  const noteSessionActivity = useCallback(() => {
    if (!sessionIdRef.current || sessionExpired) {
      return;
    }

    clearExpiryTimers();
    setShowExpiryWarning(false);
    setSecondsUntilExpiry(SESSION_WARNING_SECONDS);

    warningTimeoutRef.current = window.setTimeout(() => {
      setShowExpiryWarning(true);
      setSecondsUntilExpiry(SESSION_WARNING_SECONDS);

      countdownIntervalRef.current = window.setInterval(() => {
        setSecondsUntilExpiry((current) => (current > 0 ? current - 1 : 0));
      }, 1000);
    }, SESSION_WARNING_MS);

    expiryTimeoutRef.current = window.setTimeout(() => {
      void expireSessionLocally();
    }, SESSION_EXPIRY_MS);
  }, [clearExpiryTimers, expireSessionLocally, sessionExpired]);

  const applyReviewSnapshot = useCallback((data: PollResponse) => {
    setReviewFeed(data.reviewMessages || []);

    const nextDraft = data.draft || null;
    if (currentDraftIdRef.current !== nextDraft?.id) {
      setReviewComposer(nextDraft?.content || "");
      currentDraftIdRef.current = nextDraft?.id || null;
      setIsModifyMode(false);
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
    const activeSessionId = sessionIdRef.current;

    if (activeSessionId) {
      void closeSessionOnServer(activeSessionId);
    }

    resetLocalSession();
  }, [closeSessionOnServer, resetLocalSession]);

  useEffect(() => {
    const savedSessionId = sessionStorage.getItem(TEST_UI_SESSION_KEY);

    if (savedSessionId) {
      setSessionId(savedSessionId);
    }

  }, []);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    if (customerTranscriptRef.current) {
      if (customerAutoScrollRef.current) {
        customerTranscriptRef.current.scrollTop = customerTranscriptRef.current.scrollHeight;
      }
    }
    if (reviewTranscriptRef.current) {
      if (reviewAutoScrollRef.current) {
        reviewTranscriptRef.current.scrollTop = reviewTranscriptRef.current.scrollHeight;
      }
    }
  }, [messages, reviewFeed, reviewDraft, loading, isApproving]);

  useEffect(() => () => clearExpiryTimers(), [clearExpiryTimers]);

  const syncTranscript = useCallback(
    async (nextSessionId: string) => {
      if (isSyncingRef.current || sessionExpired) {
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

        if (sessionIdRef.current !== nextSessionId) {
          return;
        }

        applyReviewSnapshot(data);

        const hadDraftBefore = hadDraftRef.current;
        const hasDraftNow = Boolean(data.hasDraft);
        if (hadDraftRef.current && !hasDraftNow && lastSyncedAt.current) {
          lastSyncedAt.current = new Date(
            new Date(lastSyncedAt.current).getTime() - 5000
          ).toISOString();
        }
        hadDraftRef.current = hasDraftNow;

        const newPollMessages = data.messages || [];
        const unprocessed = newPollMessages.filter((message) => !seenIds.current.has(message.id));
        const sawServerActivity = unprocessed.length > 0 || hadDraftBefore !== hasDraftNow;

        if (sawServerActivity) {
          noteSessionActivity();
        }

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
    [applyReviewSnapshot, noteSessionActivity, sessionExpired]
  );

  useEffect(() => {
    if (!sessionId || sessionExpired) {
      clearExpiryTimers();
      return;
    }

    noteSessionActivity();
    void syncTranscript(sessionId);

    const interval = window.setInterval(() => {
      void syncTranscript(sessionId);
    }, hasWaiting || reviewDraft ? 1500 : 3000);

    return () => {
      window.clearInterval(interval);
    };
  }, [clearExpiryTimers, hasWaiting, noteSessionActivity, reviewDraft, sessionExpired, sessionId, syncTranscript]);

  const handleManualApprovalToggle = useCallback(() => {
    if (toggleDisabled) {
      return;
    }

    const switchingToAutonomous = manualApproval;
    noteSessionActivity();
    setManualApproval((current) => !current);
    setReviewError(null);

    if (!switchingToAutonomous) {
      setDraftStatus("No draft yet");
      return;
    }

    if (!sessionId || !reviewDraft) {
      setDraftStatus("Agent autonomous.");
      return;
    }

    const approvedContent = reviewComposer.trim() || reviewDraft.content.trim();
    if (!approvedContent) {
      setDraftStatus("No draft yet");
      return;
    }

    const localAssistantId = `local-assistant-${Date.now()}`;

    setIsApproving(true);
    setDraftStatus("Auto-sending pending draft...");

    void (async () => {
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
          throw new Error(payload.error || "Unable to auto-send the pending draft.");
        }

        if (sessionIdRef.current !== sessionId) {
          return;
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
        setIsModifyMode(false);
        currentDraftIdRef.current = null;
        hadDraftRef.current = false;
        setDraftStatus("Auto-sent after switching to autonomous.");
        noteSessionActivity();
        await syncTranscript(sessionId);
      } catch (nextError) {
        setReviewError(
          nextError instanceof Error
            ? nextError.message
            : "Unable to auto-send the pending draft."
        );
        setDraftStatus("Unable to auto-send the pending draft.");
      } finally {
        setIsApproving(false);
      }
    })();
  }, [
    manualApproval,
    noteSessionActivity,
    reviewComposer,
    reviewDraft,
    sessionId,
    syncTranscript,
    toggleDisabled,
  ]);

  const sendMessage = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();

      if (!input.trim() || loading || customerComposerLocked || sessionExpired) {
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
      setSessionExpired(false);
      setError(null);
      setReviewError(null);
      setDraftStatus(
        manualApproval ? "Sophia is drafting a reply..." : "Sophia is sending the reply..."
      );
      noteSessionActivity();

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

        if (sessionIdRef.current && resolvedSessionId && sessionIdRef.current !== resolvedSessionId) {
          return;
        }

        if (resolvedSessionId) {
          noteSessionActivity();
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
          setIsModifyMode(false);
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
    [customerComposerLocked, input, loading, manualApproval, noteSessionActivity, sessionExpired, sessionId, syncTranscript]
  );

  const handleApprove = useCallback(async () => {
    if (!sessionId || !reviewDraft || !reviewComposer.trim() || isApproving || sessionExpired) {
      return;
    }

    const approvedContent = reviewComposer.trim();
    const localAssistantId = `local-assistant-${Date.now()}`;

    setIsApproving(true);
    setReviewError(null);
    setError(null);
    noteSessionActivity();

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

      if (sessionIdRef.current !== sessionId) {
        return;
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
      setIsModifyMode(false);
      setDraftStatus("Approved and sent.");
      currentDraftIdRef.current = null;
      hadDraftRef.current = false;
      noteSessionActivity();

      await syncTranscript(sessionId);
    } catch (nextError) {
      setReviewError(
        nextError instanceof Error ? nextError.message : "Unable to approve the draft."
      );
      setDraftStatus("Unable to approve the draft.");
    } finally {
      setIsApproving(false);
    }
  }, [isApproving, noteSessionActivity, reviewComposer, reviewDraft, sessionExpired, sessionId, syncTranscript]);

  const reviewStatusTone = sessionExpired
    ? "bg-rose-400"
    : loading && manualApproval
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
            Sophia Sandbox
          </div>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            Type as Client Respond as Manager
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-white/68 sm:text-lg">
            Use Customer Screen to type client messages, then use Salon Screen to approve or auto-send Sophia&apos;s reply.
          </p>
          <details className="mx-auto mt-4 max-w-2xl rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm text-white/78">
            <summary className="cursor-pointer font-semibold text-white/90">
              How to test step by step
            </summary>
            <div className="mt-3 space-y-1.5">
              <p>1. Open Customer Screen and send a realistic client message.</p>
              <p>2. If you're in Manual Approval mode, open Salon Screen and review Sophia&apos;s draft.</p>
              <p>3. Edit if needed, then press Approve &amp; Send to publish the response.</p>
              <p>4. Toggle to Agent Autonomous to test fully automatic replies end-to-end.</p>
            </div>
          </details>
        </div>

        {showExpiryWarning || sessionExpired ? (
          <div
            className={cx(
              "mx-auto mt-8 max-w-3xl rounded-[1.4rem] border px-5 py-4 text-sm",
              sessionExpired
                ? "border-rose-400/25 bg-rose-400/12 text-rose-100"
                : "border-amber-300/25 bg-amber-300/12 text-amber-50"
            )}
          >
            {sessionExpired
              ? "This demo session expired after 3 minutes of inactivity. Start a fresh demo to continue."
              : `This demo session will expire in ${secondsUntilExpiry}s unless there is new activity.`}
          </div>
        ) : null}

        <div className="mt-6 flex justify-center">
          <div className="flex flex-col items-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white/75">
              {toggleModeText}
            </p>
            <button
              type="button"
              role="switch"
              aria-checked={manualApproval}
              onClick={handleManualApprovalToggle}
              disabled={toggleDisabled}
              className={cx(
                "mt-2 inline-flex h-7 w-[64px] items-center rounded-full border px-1 transition",
                manualApproval
                  ? "border-emerald-400/40 bg-emerald-500/20"
                  : "border-rose-400/40 bg-rose-500/20",
                toggleDisabled && "cursor-not-allowed opacity-50"
              )}
            >
              <span
                className={cx(
                  "h-5 w-5 rounded-full transition",
                  manualApproval ? "translate-x-0 bg-emerald-500" : "translate-x-[36px] bg-rose-500"
                )}
              />
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 lg:hidden">
          <button
            type="button"
            onClick={() =>
              setMobileScreen((current) => (current === "customer" ? null : "customer"))
            }
            className={cx(
              "rounded-full border px-4 py-2.5 text-sm font-semibold transition",
              mobileScreen === "customer"
                ? "border-[#c9a96e]/75 bg-[#c9a96e]/15 text-[#f5e2c2] shadow-[0_0_0_1px_rgba(201,169,110,0.2)]"
                : "border-white/20 bg-white/5 text-white/80",
              customerNeedsAttention &&
                "animate-pulse border-amber-300 shadow-[0_0_0_1px_rgba(252,211,77,0.45),0_0_26px_rgba(252,211,77,0.22)]"
            )}
          >
            Customer Screen
          </button>
          <button
            type="button"
            onClick={() =>
              setMobileScreen((current) => (current === "salon" ? null : "salon"))
            }
            className={cx(
              "rounded-full border px-4 py-2.5 text-sm font-semibold transition",
              mobileScreen === "salon"
                ? "border-emerald-300 bg-emerald-400/18 text-emerald-100"
                : "border-white/20 bg-white/5 text-white/80",
              salonNeedsAttention &&
                "animate-pulse border-emerald-300 shadow-[0_0_0_1px_rgba(110,231,183,0.5),0_0_26px_rgba(52,211,153,0.2)]"
            )}
          >
            Salon Screen
          </button>
        </div>

        <div
          className={cx(
            "relative mt-4 rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(25,21,38,0.98),rgba(18,15,28,1))] p-6 text-white shadow-[0_24px_90px_rgba(0,0,0,0.26)] lg:mt-10 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none",
            mobileScreen === "customer" && "border-[#c9a96e]/45"
          )}
        >
          {mobileScreen === "customer" ? (
            <div className="pointer-events-none absolute inset-0 rounded-[2rem] bg-[#c9a96e]/14 shadow-[inset_0_0_0_1px_rgba(201,169,110,0.22)] lg:hidden" />
          ) : null}
        <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
          <div
            className={cx(
              "relative p-0 text-white transition duration-200 lg:rounded-[2rem] lg:border lg:border-white/10 lg:bg-[linear-gradient(180deg,rgba(25,21,38,0.98),rgba(18,15,28,1))] lg:p-6 lg:shadow-[0_24px_90px_rgba(0,0,0,0.26)]",
              customerScreenDisabled && "grayscale opacity-45",
              mobileScreen === "customer" ? "block" : "hidden",
              "lg:block"
            )}
          >
            <div className="flex min-h-[112px] items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-xl">
                  💬
                </div>
                <div>
                  <h2 className="mt-1 text-2xl font-semibold uppercase tracking-[0.12em] text-white">
                    Customer Screen
                  </h2>
                </div>
              </div>
            </div>

            <div className="mt-[-25px] border-t border-white/10 pt-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/45">
                Live transcript
              </p>

              <div
                ref={customerTranscriptRef}
                onScroll={(event) => {
                  const target = event.currentTarget;
                  const distanceFromBottom =
                    target.scrollHeight - target.scrollTop - target.clientHeight;
                  customerAutoScrollRef.current = distanceFromBottom < 80;
                }}
                className="mt-3 h-[340px] space-y-3 overflow-y-auto rounded-[1.5rem] border border-white/20 bg-[#0f1320] p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)]"
              >
                {messages.length === 0 ? (
                  <div className="flex h-full items-center justify-center px-6 text-center text-sm text-white/45">
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
                              "max-w-[88%] rounded-[1.15rem] border px-3 py-3 text-sm leading-6",
                              isAssistant
                                ? "rounded-bl-md border border-[#8e73ff]/35 bg-[#7a63d8] text-white"
                                : "rounded-br-md border border-white/10 bg-white/12 text-white"
                            )}
                          >
                            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/35">
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
              <div className="mt-4 flex items-start gap-3 rounded-[1.2rem] border border-rose-200/70 bg-rose-500/35 px-4 py-3 text-sm text-rose-50 shadow-[0_0_0_1px_rgba(255,255,255,0.12)]">
                <IconAlert />
                <p>{error}</p>
              </div>
            ) : null}

            <form className="mt-5" onSubmit={sendMessage}>
              {!hasCustomerSentMessage ? (
              <div className="mb-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setInput("Hi, who are you?")}
                  disabled={loading || isApproving || customerComposerLocked}
                  className="rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-medium text-white/90 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Hi, who are you?
                </button>
                <button
                  type="button"
                  onClick={() => setInput("I want to book a haircut tomorrow at 1 PM.")}
                  disabled={loading || isApproving || customerComposerLocked}
                  className="rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-medium text-white/90 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  I want to book a haircut tomorrow at 1 PM.
                </button>
              </div>
              ) : null}
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
                  sessionExpired
                    ? "Start a fresh demo to continue."
                    : customerComposerLocked
                    ? "Approve Sophia's draft before sending the next message."
                    : "Write as the customer..."
                }
                disabled={loading || isApproving || customerComposerLocked}
                rows={2}
                className="min-h-[96px] w-full resize-none rounded-[1rem] border border-white/20 bg-white/95 px-4 py-3 text-sm leading-6 text-[#1e2331] placeholder:text-[#6d7486] focus:border-[#9da5bb] focus:outline-none disabled:cursor-not-allowed disabled:border-[#c8ccd4] disabled:bg-[#e5e7eb] disabled:text-[#6b7280] disabled:placeholder:text-[#9097a3]"
              />

              <div className="mt-4">
                <button
                  type="submit"
                  disabled={!input.trim() || loading || isApproving || customerComposerLocked}
                  className="inline-flex w-full items-center justify-center rounded-full bg-[#c9a96e] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#d6ba84] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            </form>
          </div>

          <div
            className={cx(
              "relative p-0 text-white transition duration-200 lg:rounded-[2rem] lg:border lg:border-white/10 lg:bg-[linear-gradient(180deg,rgba(25,21,38,0.98),rgba(18,15,28,1))] lg:p-6 lg:shadow-[0_24px_90px_rgba(0,0,0,0.26)]",
              mobileScreen === "salon" ? "block" : "hidden",
              "lg:block"
            )}
          >
            <div className="flex min-h-[112px] items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-xl">
                  <Logo className="h-7 w-7" />
                </div>
                <div>
                  <h2 className="mt-1 text-2xl font-semibold uppercase tracking-[0.12em] text-white">
                    Salon Screen
                  </h2>
                </div>
              </div>
            </div>

            <div className={cx("transition duration-200", salonScreenDisabled && "grayscale opacity-45")}>
            <div className="mt-[-25px] border-t border-white/10 pt-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">
                  <span className={cx("h-2 w-2 rounded-full", reviewStatusTone)} />
                  <span>{draftStatus}</span>
                </div>
              </div>

              <div
                ref={reviewTranscriptRef}
                onScroll={(event) => {
                  const target = event.currentTarget;
                  const distanceFromBottom =
                    target.scrollHeight - target.scrollTop - target.clientHeight;
                  reviewAutoScrollRef.current = distanceFromBottom < 80;
                }}
                className="mt-3 h-[340px] space-y-3 overflow-y-auto rounded-[1.5rem] border border-white/20 bg-[#0f1320] p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)]"
              >
                {reviewFeed.length === 0 ? (
                  <div className="flex h-full items-center justify-center px-6 text-center text-sm text-white/45">
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
                              ? "border-white/10 bg-white/12 text-white"
                              : isDraft
                                ? "border-[#8e73ff]/30 bg-[#7a63d8]/90 text-white"
                                : "border-[#8e73ff]/35 bg-[#7a63d8] text-white"
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

            <div className="mt-5">
              {loading && manualApproval ? (
                <div className="flex min-h-[96px] items-center justify-center">
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
                  ref={reviewComposerRef}
                  value={reviewComposer}
                  onChange={(event) => {
                    setReviewComposer(event.target.value);
                    setIsModifyMode(true);
                  }}
                  disabled={sessionExpired || !reviewDraft || isApproving}
                  readOnly={!isModifyMode}
                  rows={2}
                  placeholder={sessionExpired ? "Session expired." : "No draft yet"}
                  className={cx(
                    "min-h-[96px] w-full resize-none rounded-[1rem] border px-4 py-3 text-sm leading-6 focus:outline-none disabled:cursor-not-allowed disabled:border-[#c8ccd4] disabled:bg-[#e5e7eb] disabled:text-[#6b7280] disabled:placeholder:text-[#9097a3]",
                    isModifyMode
                      ? "border-white/20 bg-white/95 text-[#1e2331] placeholder:text-[#6d7486] focus:border-[#9da5bb]"
                      : "border-white/15 bg-white/70 text-[#5f6675] placeholder:text-[#8a90a0] focus:border-[#9da5bb]"
                  )}
                />
              )}

              <div className="mt-4 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void handleApprove()}
                  disabled={sessionExpired || !draftReady || isApproving}
                  className="inline-flex w-[70%] items-center justify-center gap-2 rounded-[1.1rem] bg-[#1e9e63] px-5 py-3.5 text-sm font-semibold text-white shadow-[0_18px_35px_rgba(30,158,99,0.28)] transition hover:bg-[#188754] disabled:cursor-not-allowed disabled:opacity-50 lg:w-1/2"
                >
                  {isApproving ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#1d1711]/20 border-t-[#1d1711]" />
                  ) : (
                    <IconCheck />
                  )}
                  {isApproving ? "Sending..." : "Approve & Send"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsModifyMode(true);
                    reviewComposerRef.current?.focus();
                  }}
                  disabled={sessionExpired || isApproving || !reviewDraft}
                  className="inline-flex w-[30%] items-center justify-center rounded-[1.1rem] bg-[#c83b3b] px-3 py-3.5 text-sm font-semibold text-white transition hover:bg-[#b02f2f] disabled:cursor-not-allowed disabled:opacity-50 lg:w-1/2"
                >
                  Modify
                </button>
              </div>

              {reviewError ? (
                <div className="mt-4 flex items-start gap-3 rounded-[1.2rem] border border-rose-200/70 bg-rose-500/35 px-4 py-3 text-sm text-rose-50 shadow-[0_0_0_1px_rgba(255,255,255,0.12)]">
                  <IconAlert />
                  <p>{reviewError}</p>
                </div>
              ) : null}
            </div>
            </div>
          </div>
          {mobileScreen === null ? (
            <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.02] px-4 py-6 text-center text-sm text-white/65 lg:hidden">
              Select Customer Screen or Salon Screen to continue.
            </div>
          ) : null}
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
