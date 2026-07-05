"use client";

import { useCallback, useEffect, useState } from "react";
import type { FeedbackItem, FeedbackStatus } from "@/lib/shared/types";

const dashboardBasePath = (() => {
  const value = process.env.NEXT_PUBLIC_DASHBOARD_BASE_PATH?.trim();
  if (!value || value === "/") return "";
  return value.endsWith("/") ? value.slice(0, -1) : value;
})();

const typeMeta: Record<FeedbackItem["type"], { icon: string; label: string }> = {
  bug: { icon: "🐛", label: "Broken" },
  idea: { icon: "💡", label: "Idea" },
  question: { icon: "❓", label: "Question" }
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function replyMailto(item: FeedbackItem): string {
  if (!item.contactEmail) return "#";
  const subject = encodeURIComponent("Re: Your ReceiptCam feedback");
  const quoted = item.message
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  const body = encodeURIComponent(`Hi,\n\nThanks for reaching out!\n\n\n\n--- Your message ---\n${quoted}\n`);
  return `mailto:${item.contactEmail}?subject=${subject}&body=${body}`;
}

export default function ReceiptMessages() {
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"open" | "all">("open");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${dashboardBasePath}/api/feedback`);
      if (!response.ok) {
        setError(`Could not load messages (HTTP ${response.status}).`);
        setItems([]);
        return;
      }
      const data = (await response.json()) as { items: FeedbackItem[]; message?: string };
      setItems(data.items ?? []);
      if (data.message) setError(data.message);
    } catch {
      setError("Could not load messages.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setStatus = useCallback(
    async (id: string, status: FeedbackStatus) => {
      setItems((current) =>
        current ? current.map((item) => (item.id === id ? { ...item, status } : item)) : current
      );
      try {
        const response = await fetch(`${dashboardBasePath}/api/feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, status })
        });
        if (!response.ok) void load();
      } catch {
        void load();
      }
    },
    [load]
  );

  const visible = (items ?? []).filter((item) => (filter === "open" ? item.status !== "closed" : true));
  const openCount = (items ?? []).filter((item) => item.status === "new").length;

  return (
    <section className="messagesPanel">
      <div className="messagesHeader">
        <h3>
          Messages{openCount > 0 ? <span className="messagesBadge">{openCount} new</span> : null}
        </h3>
        <div className="actions">
          <button
            type="button"
            className="iconButton ghost"
            onClick={() => setFilter(filter === "open" ? "all" : "open")}
          >
            {filter === "open" ? "Show all" : "Show open"}
          </button>
          <button type="button" className="iconButton" onClick={() => void load()} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {error ? <p className="errorText">{error}</p> : null}

      {items !== null && visible.length === 0 && !error ? (
        <p className="messagesEmpty">
          No messages{filter === "open" ? " open" : ""} yet. The in-app Help &amp; Feedback form ships with
          version 2.1.1 — messages will appear here once users start writing.
        </p>
      ) : null}

      <ul className="messagesList">
        {visible.map((item) => (
          <li key={item.id} className={`messageCard status-${item.status}`}>
            <div className="messageMeta">
              <span className="messageType">
                {typeMeta[item.type].icon} {typeMeta[item.type].label}
              </span>
              <span className={item.isPro ? "messageTag pro" : "messageTag"}>
                {item.isPro ? "Subscriber" : item.isAnonymousUser ? "Anonymous" : "Free"}
              </span>
              {item.appVersion ? <span className="messageTag">v{item.appVersion}</span> : null}
              {item.osVersion ? <span className="messageTag">iOS {item.osVersion}</span> : null}
              <span className="messageDate">{formatDate(item.createdAt)}</span>
              <span className={`messageStatus ${item.status}`}>{item.status}</span>
            </div>
            <p className="messageBody">{item.message}</p>
            {item.attachmentUrl ? (
              <a href={item.attachmentUrl} target="_blank" rel="noreferrer" className="messageAttachment">
                View attachment
              </a>
            ) : null}
            <div className="messageActions actions">
              {item.contactEmail ? (
                <a
                  className="iconButton"
                  href={replyMailto(item)}
                  onClick={() => void setStatus(item.id, "replied")}
                >
                  Reply by email
                </a>
              ) : (
                <span className="messageNoEmail">No contact email left</span>
              )}
              {item.status !== "closed" ? (
                <button type="button" className="iconButton ghost" onClick={() => void setStatus(item.id, "closed")}>
                  Close
                </button>
              ) : (
                <button type="button" className="iconButton ghost" onClick={() => void setStatus(item.id, "new")}>
                  Reopen
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
