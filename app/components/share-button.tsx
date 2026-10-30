import { Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";

export function ShareButton({ title, path }: { title: string; path: string }) {
  async function share() {
    const url = new URL(path, window.location.origin).toString();
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success("リンクをコピーしました");
    } catch {
      toast.error("リンクをコピーできませんでした");
    }
  }
  return (
    <Button variant="outline" size="sm" onClick={share} type="button">
      <Share2 /> 共有
    </Button>
  );
}
