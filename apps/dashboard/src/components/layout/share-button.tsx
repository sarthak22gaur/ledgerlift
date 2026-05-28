"use client";

import { useCallback, useState } from "react";
import { Check, Copy, Link2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DEFAULT_TTL_MINUTES, TTL_OPTIONS } from "@/lib/share-token";
import { cn } from "@/lib/utils";

export default function ShareButton() {
  const [open, setOpen] = useState(false);
  const [ttl, setTtl] = useState(DEFAULT_TTL_MINUTES);
  const [loading, setLoading] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const generateLink = useCallback(async (ttlMinutes: number) => {
    setLoading(true);
    setError("");
    setCopied(false);

    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ttlMinutes }),
      });
      if (!res.ok) throw new Error("Failed to generate share link");

      const { token, expiresAt: exp } = await res.json();
      const url = new URL(window.location.origin);
      url.searchParams.set("token", token);
      setShareUrl(url.toString());
      setExpiresAt(exp);
    } catch {
      setError("Could not generate share link");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleOpen = useCallback(
    (isOpen: boolean) => {
      setOpen(isOpen);
      if (!isOpen) {
        setShareUrl("");
        setExpiresAt(null);
        setCopied(false);
        setError("");
      }
    },
    [],
  );

  const copyToClipboard = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const input = document.querySelector<HTMLInputElement>("[data-share-url]");
      if (input) {
        input.select();
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    }
  }, [shareUrl]);

  const remainingMs = expiresAt ? Math.max(0, expiresAt - Date.now()) : 0;
  const remainingMinutes = Math.ceil(remainingMs / 60_000);
  const remainingLabel =
    remainingMs < 60_000
      ? `${Math.ceil(remainingMs / 1000)} seconds`
      : `${remainingMinutes} minute${remainingMinutes !== 1 ? "s" : ""}`;

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="Share dashboard" />
        }
      >
        <Link2 className="size-4" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share Dashboard</DialogTitle>
          <DialogDescription>
            Generate a temporary link to share read-only access.
          </DialogDescription>
        </DialogHeader>

        {/* TTL selector */}
        {!shareUrl && !loading && (
          <div className="space-y-3">
            <label className="text-sm font-medium">Link expires after</label>
            <div className="flex flex-wrap gap-2">
              {TTL_OPTIONS.map((opt) => (
                <button
                  key={opt.minutes}
                  type="button"
                  onClick={() => setTtl(opt.minutes)}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-sm transition-colors",
                    ttl === opt.minutes
                      ? "border-primary bg-primary/10 text-primary font-medium"
                      : "border-border text-muted-foreground hover:border-foreground/30"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <Button onClick={() => generateLink(ttl)} className="w-full">
              Generate Link
            </Button>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {shareUrl && !loading && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Input
                data-share-url
                readOnly
                value={shareUrl}
                className="flex-1 font-mono text-xs"
                onFocus={(e) => e.target.select()}
              />
              <Button
                variant="outline"
                size="icon"
                onClick={copyToClipboard}
                aria-label={copied ? "Copied" : "Copy link"}
              >
                {copied ? (
                  <Check className="size-4 text-green-500" />
                ) : (
                  <Copy className="size-4" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Expires in {remainingLabel}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
