"use client";

import { Button } from "@/components/ui/button";
import { Github, Loader2 } from "lucide-react";
import { useAuth } from "../hooks";

interface LoginButtonProps {
  className?: string;
  size?: "default" | "sm" | "lg" | "icon";
  variant?: "default" | "outline" | "ghost" | "secondary";
}

export function LoginButton({
  className,
  size = "default",
  variant = "default",
}: LoginButtonProps) {
  const { signIn, isLoading } = useAuth();

  if (isLoading) {
    return (
      <Button disabled size={size} variant={variant} className={className}>
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        로딩 중...
      </Button>
    );
  }

  return (
    <Button onClick={signIn} size={size} variant={variant} className={className}>
      <Github className="mr-2 h-4 w-4" />
      GitHub로 로그인
    </Button>
  );
}
