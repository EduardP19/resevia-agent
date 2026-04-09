"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Logo from "../(dashboard)/Logo";
import styles from "./theme.module.css";

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
const TEST_UI_PARAM_KEY = "resevia_sophia_sandbox_p";
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
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [themeMounted, setThemeMounted] = useState(false);
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
  const [pParam, setPParam] = useState<string | null>(null);

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
      const response = await fetch("/api/sophia-sandbox/expire", {
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
    const saved = localStorage.getItem("resevia_sophia_sandbox_theme");
    if (saved === "light" || saved === "dark") {
      setTheme(saved);
    }
    setThemeMounted(true);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      localStorage.setItem("resevia_sophia_sandbox_theme", next);
      return next;
    });
  }, []);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("p")?.trim();

    if (fromUrl) {
      localStorage.setItem(TEST_UI_PARAM_KEY, fromUrl);
      setPParam(fromUrl);
      return;
    }

    const savedParam = localStorage.getItem(TEST_UI_PARAM_KEY)?.trim();
    if (savedParam) {
      setPParam(savedParam);
      return;
    }

    setPParam(null);
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

        const response = await fetch(`/api/sophia-sandbox/poll?${query.toString()}`, {
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
        const response = await fetch("/api/sophia-sandbox/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            content: approvedContent,
            p: pParam || undefined,
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
    pParam,
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
        const response = await fetch("/api/sophia-sandbox/message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            id: sessionId,
            manualApproval,
            p: pParam || undefined,
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
    [customerComposerLocked, input, loading, manualApproval, noteSessionActivity, pParam, sessionExpired, sessionId, syncTranscript]
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
      const response = await fetch("/api/sophia-sandbox/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          content: approvedContent,
          p: pParam || undefined,
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
  }, [isApproving, noteSessionActivity, pParam, reviewComposer, reviewDraft, sessionExpired, sessionId, syncTranscript]);

  const reviewStatusTone = sessionExpired
    ? "bg-[rgb(var(--sb-danger))]"
    : loading && manualApproval
      ? "bg-[rgb(var(--sb-gold))]"
      : draftReady
        ? "bg-[rgb(var(--sb-success))]"
        : manualApproval
          ? "bg-[rgb(var(--sb-surface))]/30"
          : "bg-[rgb(var(--sb-purple))]";

  return (
    <section
      data-theme={theme}
      className={cx(
        styles.root,
        "relative min-h-[100dvh] overflow-hidden bg-[rgb(var(--sb-bg))] px-4 pb-16 pt-20 text-[rgb(var(--sb-fg))] sm:px-6 sm:pt-24"
      )}
    >
      <div className="absolute right-4 top-4 z-30 sm:right-6 sm:top-6">
        <button
          type="button"
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className={styles.switch}
        >
          <span className={cx(styles.dot, theme === "light" && styles.dotLight)} />
          <span className={styles.label}>
            {themeMounted ? (theme === "dark" ? "Dark" : "Light") : "Theme"}
          </span>
        </button>
      </div>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(var(--sb-gold),0.18),transparent_40%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_bottom_right,rgba(var(--sb-purple),0.16),transparent_46%)]" />
      <div className="relative mx-auto max-w-7xl">
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-[rgb(var(--sb-danger))]/35 bg-[rgb(var(--sb-danger))]/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-[rgb(var(--sb-fg))]">
            <span className="h-2.5 w-2.5 rounded-full bg-[rgb(var(--sb-danger))]" />
            Sophia Sandbox
          </div>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight text-[rgb(var(--sb-fg))] sm:text-5xl">
            Type as Client. <br /> Respond as Manager.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-[rgb(var(--sb-muted))] sm:text-lg">
            1. Customer Screen to type client messages <br /> 2. Salon Screen to approve or auto-send Sophia&apos;s reply.
          </p>
          <details className="mx-auto mt-4 max-w-2xl rounded-2xl border border-[rgb(var(--sb-line))]/35 bg-[rgb(var(--sb-surface))]/5 px-4 py-3 text-left text-sm text-[rgb(var(--sb-muted))]">
            <summary className="cursor-pointer font-semibold text-[rgb(var(--sb-fg))]">
              How to test step by step - read more...
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
                ? "border-[rgb(var(--sb-danger))]/35 bg-[rgb(var(--sb-danger))]/12 text-[rgb(var(--sb-fg))]"
                : "border-[rgb(var(--sb-gold))]/35 bg-[rgb(var(--sb-gold))]/12 text-[rgb(var(--sb-fg))]"
            )}
          >
            {sessionExpired
              ? "This demo session expired after 3 minutes of inactivity. Start a fresh demo to continue."
              : `This demo session will expire in ${secondsUntilExpiry}s unless there is new activity.`}
          </div>
        ) : null}

        <div className="mt-6 flex justify-center">
          <div className="flex flex-col items-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[rgb(var(--sb-muted))]">
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
                  ? "border-[rgb(var(--sb-success))]/45 bg-[rgb(var(--sb-success))]/20"
                  : "border-[rgb(var(--sb-danger))]/45 bg-[rgb(var(--sb-danger))]/20",
                toggleDisabled && "cursor-not-allowed opacity-50"
              )}
            >
              <span
                className={cx(
                  "h-5 w-5 rounded-full transition",
                  manualApproval
                    ? "translate-x-0 bg-[rgb(var(--sb-success))]"
                    : "translate-x-[36px] bg-[rgb(var(--sb-danger))]"
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
              "rounded-full border px-4 py-2.5 text-sm font-semibold transition duration-200",
              mobileScreen === "customer"
                ? cx(
                    "border-[rgb(var(--sb-gold))] text-[rgb(var(--sb-fg))]",
                    theme === "light"
                      ? "bg-[rgb(var(--sb-gold-30))] shadow-[0_10px_30px_rgba(28,42,68,0.14)]"
                      : "bg-[rgb(var(--sb-gold))]/20 shadow-[0_0_0_1px_rgba(var(--sb-gold),0.42),0_0_26px_rgba(var(--sb-gold),0.42)]"
                  )
                : theme === "light"
                  ? "border-[rgb(var(--sb-line))]/70 bg-[rgb(var(--sb-surface))] text-[rgb(var(--sb-muted))] shadow-[0_10px_26px_rgba(28,42,68,0.08)]"
                  : "border-[rgb(var(--sb-line))]/20 bg-[rgb(var(--sb-surface))]/5 text-[rgb(var(--sb-muted))]",
              customerNeedsAttention &&
                "animate-pulse border-[rgb(var(--sb-gold))] shadow-[0_0_0_1px_rgba(var(--sb-gold),0.5),0_0_28px_rgba(var(--sb-gold),0.38)]"
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
              "rounded-full border px-4 py-2.5 text-sm font-semibold transition duration-200",
              mobileScreen === "salon"
                ? cx(
                    "border-[rgb(var(--sb-purple))] text-[rgb(var(--sb-fg))]",
                    theme === "light"
                      ? "bg-[rgb(var(--sb-purple-30))] shadow-[0_10px_30px_rgba(28,42,68,0.14)]"
                      : "bg-[rgb(var(--sb-purple))]/22 shadow-[0_0_0_1px_rgba(var(--sb-purple),0.45),0_0_26px_rgba(var(--sb-purple),0.38)]"
                  )
                : theme === "light"
                  ? "border-[rgb(var(--sb-line))]/70 bg-[rgb(var(--sb-surface))] text-[rgb(var(--sb-muted))] shadow-[0_10px_26px_rgba(28,42,68,0.08)]"
                  : "border-[rgb(var(--sb-line))]/20 bg-[rgb(var(--sb-surface))]/5 text-[rgb(var(--sb-muted))]",
              salonNeedsAttention &&
                "animate-pulse border-[rgb(var(--sb-purple))] shadow-[0_0_0_1px_rgba(var(--sb-purple),0.52),0_0_28px_rgba(var(--sb-purple),0.45)]"
            )}
          >
            Salon Screen
          </button>
        </div>

        <div
          className={cx(
            "relative mt-4 rounded-[2rem] border border-[rgb(var(--sb-line))]/10 bg-transparent p-6 text-[rgb(var(--sb-fg))] shadow-[0_24px_90px_rgba(0,0,0,0.26)] lg:mt-10 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none",
            theme === "light" &&
              "bg-[rgb(var(--sb-surface))] shadow-[0_18px_60px_rgba(28,42,68,0.10)]",
            mobileScreen === "customer" && "border-[rgb(var(--sb-gold))]/52",
            mobileScreen === "salon" && "border-[rgb(var(--sb-purple))]/48"
          )}
        >
          {mobileScreen === "customer" ? (
            <div
              className={cx(
                "pointer-events-none absolute inset-0 rounded-[2rem] lg:hidden",
                theme === "light"
                  ? "bg-[rgb(var(--sb-gold-30))]"
                  : "bg-[rgb(var(--sb-gold))]/14 shadow-[inset_0_0_0_1px_rgba(var(--sb-gold),0.22)]"
              )}
            />
          ) : null}
          {mobileScreen === "salon" ? (
            <div
              className={cx(
                "pointer-events-none absolute inset-0 rounded-[2rem] lg:hidden",
                theme === "light"
                  ? "bg-[rgb(var(--sb-purple-30))]"
                  : "bg-[rgb(var(--sb-purple))]/10 shadow-[inset_0_0_0_1px_rgba(var(--sb-purple),0.24)]"
              )}
            />
          ) : null}
          <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
            <div
	            className={cx(
	              "relative p-0 text-[rgb(var(--sb-fg))] transition duration-200 lg:rounded-[2rem] lg:border lg:border-[rgb(var(--sb-gold))]/55 lg:bg-[rgb(var(--sb-gold))]/5 lg:p-6 lg:shadow-[0_24px_90px_rgba(0,0,0,0.26),0_0_0_1px_rgba(var(--sb-gold),0.22)]",
	              theme === "light" &&
	                "lg:border-[rgb(var(--sb-gold))]/35 lg:bg-[rgb(var(--sb-gold-30))] lg:shadow-[0_18px_60px_rgba(28,42,68,0.12)]",
	              customerScreenDisabled && "grayscale opacity-45",
	              mobileScreen === "customer" ? "block" : "hidden",
	              "lg:block"
            )}
          >
            <div className="flex min-h-[112px] items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[rgb(var(--sb-line))]/10 bg-[rgb(var(--sb-surface))]/5 text-xl">
                  💬
                </div>
                <div>
                  <h2 className="mt-1 text-2xl font-semibold uppercase tracking-[0.12em] text-[rgb(var(--sb-fg))]">
                    Customer Screen
                  </h2>
                </div>
              </div>
            </div>

            <div className="mt-[-25px] border-t border-[rgb(var(--sb-line))]/10 pt-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[rgb(var(--sb-subtle))]">
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
	                className={cx(
	                  "mt-3 h-[340px] space-y-3 overflow-y-auto rounded-[1.5rem] border border-[rgb(var(--sb-line))]/20 bg-[rgb(var(--sb-panel))] p-4 shadow-[inset_0_0_0_1px_rgba(var(--sb-line),0.03)]",
	                  theme === "light" &&
	                    "border-[rgb(var(--sb-line))]/75 bg-[rgb(var(--sb-surface))] shadow-[inset_0_0_0_1px_rgba(var(--sb-ink-dark),0.06)]"
	                )}
	              >
                {messages.length === 0 ? (
                  <div className="flex h-full items-center justify-center px-6 text-center text-sm text-[rgb(var(--sb-subtle))]">
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
	                          <div className="inline-flex items-center gap-3 rounded-[1.25rem] border border-[rgb(var(--sb-line))]/70 bg-[rgb(var(--sb-surface))]/75 px-4 py-3 text-sm text-[rgb(var(--sb-ink-dark))]">
	                            <div className="flex items-center gap-1.5">
	                              <span
	                                className="h-2 w-2 animate-bounce rounded-full bg-[rgb(var(--sb-gold))]"
	                                style={{ animationDelay: "0ms" }}
                              />
                              <span
                                className="h-2 w-2 animate-bounce rounded-full bg-[rgb(var(--sb-gold))]"
                                style={{ animationDelay: "120ms" }}
                              />
                              <span
                                className="h-2 w-2 animate-bounce rounded-full bg-[rgb(var(--sb-gold))]"
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
	                                ? "rounded-bl-md border border-[rgb(var(--sb-purple))]/35 bg-[rgb(var(--sb-purple-strong))] text-[rgb(var(--sb-fg))]"
	                                : theme === "light"
	                                  ? "rounded-br-md border-[rgb(var(--sb-line))]/75 bg-[rgb(var(--sb-panel))] text-[rgb(var(--sb-fg))]"
	                                  : "rounded-br-md border-[rgb(var(--sb-line))]/10 bg-[rgb(var(--sb-surface))]/12 text-[rgb(var(--sb-fg))]"
	                            )}
	                          >
                            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[rgb(var(--sb-subtle))]">
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
                    <div className="inline-flex items-center gap-2 rounded-[1.25rem] border border-[rgb(var(--sb-line))]/70 bg-[rgb(var(--sb-surface))]/80 px-4 py-3 text-sm text-[rgb(var(--sb-ink-dark))]">
                      <span className="h-2 w-2 animate-bounce rounded-full bg-[rgb(var(--sb-gold))]" />
                      <span
                        className="h-2 w-2 animate-bounce rounded-full bg-[rgb(var(--sb-gold))]"
                        style={{ animationDelay: "120ms" }}
                      />
                      <span
                        className="h-2 w-2 animate-bounce rounded-full bg-[rgb(var(--sb-gold))]"
                        style={{ animationDelay: "240ms" }}
                      />
                    </div>
                  </div>
                ) : null}

                <div ref={customerScrollRef} />
              </div>
            </div>

            {error ? (
              <div className="mt-4 flex items-start gap-3 rounded-[1.2rem] border border-[rgb(var(--sb-danger))]/35 bg-[rgb(var(--sb-danger))]/12 px-4 py-3 text-sm text-[rgb(var(--sb-fg))] shadow-[0_0_0_1px_rgba(var(--sb-line),0.12)]">
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
                    className={cx(
                      "rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
                      theme === "light"
                        ? "border-[rgb(var(--sb-line))]/70 bg-[rgb(var(--sb-surface))] text-[rgb(var(--sb-fg))] hover:bg-[rgb(var(--sb-surface))]/90"
                        : "border-[rgb(var(--sb-line))]/25 bg-[rgb(var(--sb-surface))]/10 text-[rgb(var(--sb-fg))] hover:bg-[rgb(var(--sb-surface))]/15"
                    )}
                  >
                    Hi, who are you?
                  </button>
                  <button
                    type="button"
                    onClick={() => setInput("I want to book a haircut tomorrow at 1 PM.")}
                    disabled={loading || isApproving || customerComposerLocked}
                    className={cx(
                      "rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
                      theme === "light"
                        ? "border-[rgb(var(--sb-line))]/70 bg-[rgb(var(--sb-surface))] text-[rgb(var(--sb-fg))] hover:bg-[rgb(var(--sb-surface))]/90"
                        : "border-[rgb(var(--sb-line))]/25 bg-[rgb(var(--sb-surface))]/10 text-[rgb(var(--sb-fg))] hover:bg-[rgb(var(--sb-surface))]/15"
                    )}
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
                className="min-h-[96px] w-full resize-none rounded-[1rem] border border-[rgb(var(--sb-line))]/20 bg-[rgb(var(--sb-surface))]/95 px-4 py-3 text-sm leading-6 text-[rgb(var(--sb-ink-dark))] placeholder:text-[rgb(var(--sb-muted))] focus:border-[rgb(var(--sb-purple))] focus:outline-none disabled:cursor-not-allowed disabled:border-[rgb(var(--sb-line))] disabled:bg-[rgb(var(--sb-panel))] disabled:text-[rgb(var(--sb-muted))] disabled:placeholder:text-[rgb(var(--sb-muted))]"
              />

              <div className="mt-4">
                <button
                  type="submit"
                  disabled={!input.trim() || loading || isApproving || customerComposerLocked}
                  className="inline-flex w-full items-center justify-center rounded-full bg-[rgb(var(--sb-gold))] px-5 py-3 text-sm font-semibold text-[rgb(var(--sb-fg))] transition hover:bg-[rgb(var(--sb-gold))]/80 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            </form>
          </div>

          <div
            className={cx(
              "relative p-0 text-[rgb(var(--sb-fg))] transition duration-200 lg:rounded-[2rem] lg:border lg:border-[rgb(var(--sb-purple))]/52 lg:bg-[rgb(var(--sb-purple))]/5 lg:p-6 lg:shadow-[0_24px_90px_rgba(0,0,0,0.26),0_0_0_1px_rgba(var(--sb-purple),0.2)]",
              theme === "light" &&
                "lg:border-[rgb(var(--sb-purple))]/30 lg:bg-[rgb(var(--sb-purple-30))] lg:shadow-[0_18px_60px_rgba(28,42,68,0.12)]",
              mobileScreen === "salon" ? "block" : "hidden",
              "lg:block"
            )}
          >
            <div className="flex min-h-[112px] items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[rgb(var(--sb-line))]/10 bg-[rgb(var(--sb-surface))]/5 text-xl">
                  <Logo className="h-7 w-7" />
                </div>
                <div>
                  <h2 className="mt-1 text-2xl font-semibold uppercase tracking-[0.12em] text-[rgb(var(--sb-fg))]">
                    Salon Screen
                  </h2>
                </div>
              </div>
            </div>

            <div
              className={cx(
                "transition duration-200",
                salonScreenDisabled && "grayscale opacity-45"
              )}
            >
              <div className="mt-[-25px] border-t border-[rgb(var(--sb-line))]/10 pt-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[rgb(var(--sb-muted))]">
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
                  className={cx(
                    "mt-3 h-[340px] space-y-3 overflow-y-auto rounded-[1.5rem] border border-[rgb(var(--sb-line))]/20 bg-[rgb(var(--sb-panel))] p-4 shadow-[inset_0_0_0_1px_rgba(var(--sb-line),0.03)]",
                    theme === "light" &&
                      "border-[rgb(var(--sb-line))]/75 bg-[rgb(var(--sb-surface))] shadow-[inset_0_0_0_1px_rgba(var(--sb-ink-dark),0.06)]"
                  )}
                >
                  {reviewFeed.length === 0 ? (
                    <div className="flex h-full items-center justify-center px-6 text-center text-sm text-[rgb(var(--sb-subtle))]">
                      No messages yet.
                    </div>
                  ) : (
                    reviewFeed.map((message) => {
                      const isUser = message.role === "user";
                      const isDraft = message.role === "draft";

                      return (
                        <div
                          key={message.id}
                          className={cx("flex", isUser ? "justify-start" : "justify-end")}
                        >
                          <div
                            className={cx(
                              "max-w-[88%] rounded-[1.15rem] border px-3 py-3 text-sm leading-6",
                              isUser
                                ? theme === "light"
                                  ? "border-[rgb(var(--sb-line))]/75 bg-[rgb(var(--sb-panel))] text-[rgb(var(--sb-fg))]"
                                  : "border-[rgb(var(--sb-line))]/10 bg-[rgb(var(--sb-surface))]/12 text-[rgb(var(--sb-fg))]"
                                : isDraft
                                  ? "border-[rgb(var(--sb-purple))]/30 bg-[rgb(var(--sb-purple-strong))]/90 text-[rgb(var(--sb-fg))]"
                                  : "border-[rgb(var(--sb-purple))]/35 bg-[rgb(var(--sb-purple-strong))] text-[rgb(var(--sb-fg))]"
                            )}
                          >
                            <div className="mb-2 flex items-center justify-between gap-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--sb-subtle))]">
                              <span>
                                {isUser ? "Customer" : isDraft ? "Sophia draft" : "Sophia"}
                              </span>
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
                  <div className="inline-flex items-center gap-2 text-[rgb(var(--sb-muted))]">
                    <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-[rgb(var(--sb-gold))]" />
                    <span
                      className="h-2.5 w-2.5 animate-bounce rounded-full bg-[rgb(var(--sb-gold))]"
                      style={{ animationDelay: "120ms" }}
                    />
                    <span
                      className="h-2.5 w-2.5 animate-bounce rounded-full bg-[rgb(var(--sb-gold))]"
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
                    "min-h-[96px] w-full resize-none rounded-[1rem] border px-4 py-3 text-sm leading-6 focus:outline-none disabled:cursor-not-allowed disabled:border-[rgb(var(--sb-line))] disabled:bg-[rgb(var(--sb-panel))] disabled:text-[rgb(var(--sb-muted))] disabled:placeholder:text-[rgb(var(--sb-muted))]",
                    isModifyMode
                      ? "border-[rgb(var(--sb-line))]/20 bg-[rgb(var(--sb-surface))]/95 text-[rgb(var(--sb-ink-dark))] placeholder:text-[rgb(var(--sb-muted))] focus:border-[rgb(var(--sb-purple))]"
                      : "border-[rgb(var(--sb-line))]/15 bg-[rgb(var(--sb-surface))]/70 text-[rgb(var(--sb-muted))] placeholder:text-[rgb(var(--sb-subtle))] focus:border-[rgb(var(--sb-purple))]"
                  )}
                />
              )}

              <div className="mt-4 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void handleApprove()}
                  disabled={sessionExpired || !draftReady || isApproving}
                  className="inline-flex h-12 w-[70%] items-center justify-center gap-2 rounded-[1.1rem] bg-[rgb(var(--sb-success))] px-5 text-sm font-semibold text-[rgb(var(--sb-fg))] shadow-[0_18px_35px_rgba(30,158,99,0.28)] transition hover:bg-[rgb(var(--sb-success-strong))] disabled:cursor-not-allowed disabled:opacity-50 lg:w-1/2"
                >
                  {isApproving ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-[rgb(var(--sb-ink-dark))]/20 border-t-[rgb(var(--sb-ink-dark))]" />
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
                  className="inline-flex h-12 w-[30%] items-center justify-center rounded-[1.1rem] bg-[rgb(var(--sb-danger))] px-3 text-sm font-semibold text-[rgb(var(--sb-fg))] transition hover:bg-[rgb(var(--sb-danger-strong))] disabled:cursor-not-allowed disabled:opacity-50 lg:w-1/2"
                >
                  Modify
                </button>
              </div>

              {reviewError ? (
                <div className="mt-4 flex items-start gap-3 rounded-[1.2rem] border border-[rgb(var(--sb-danger))]/35 bg-[rgb(var(--sb-danger))]/12 px-4 py-3 text-sm text-[rgb(var(--sb-fg))] shadow-[0_0_0_1px_rgba(var(--sb-line),0.12)]">
                  <IconAlert />
                  <p>{reviewError}</p>
                </div>
              ) : null}
            </div>
            </div>
          </div>
          {mobileScreen === null ? (
            <div
              className={cx(
                "rounded-[1.25rem] border px-4 py-6 text-center text-sm lg:hidden",
                theme === "light"
                  ? "border-[rgb(var(--sb-line))]/75 bg-[rgb(var(--sb-surface))] text-[rgb(var(--sb-muted))] shadow-[0_12px_32px_rgba(28,42,68,0.08)]"
                  : "border-[rgb(var(--sb-line))]/10 bg-[rgb(var(--sb-surface))]/5 text-[rgb(var(--sb-muted))]"
              )}
            >
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
              className={cx(
                "rounded-full border px-4 py-2 text-sm transition",
                theme === "light"
                  ? "border-[rgb(var(--sb-line))]/75 bg-[rgb(var(--sb-surface))] text-[rgb(var(--sb-muted))] shadow-[0_10px_28px_rgba(28,42,68,0.08)] hover:bg-[rgb(var(--sb-surface))]/90 hover:text-[rgb(var(--sb-fg))]"
                  : "border-[rgb(var(--sb-line))]/10 bg-[rgb(var(--sb-surface))]/[0.04] text-[rgb(var(--sb-muted))] hover:bg-[rgb(var(--sb-surface))]/[0.07] hover:text-[rgb(var(--sb-fg))]"
              )}
            >
              Start a fresh demo
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
