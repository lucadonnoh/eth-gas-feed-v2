"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface FlashValueProps {
  value: number;
  children: React.ReactNode;
  className?: string;
}

export function FlashValue({ value, children, className }: FlashValueProps) {
  const [flashClass, setFlashClass] = useState("");
  const prevValueRef = useRef(value);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (value !== prevValueRef.current) {
      // Clear any existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Determine flash color
      const isIncrease = value > prevValueRef.current;
      const flashColor = isIncrease ? "bg-green-500/30" : "bg-red-500/30";
      
      // Apply flash
      setFlashClass(flashColor);
      
      // Remove flash after 400ms
      timeoutRef.current = setTimeout(() => {
        setFlashClass("");
      }, 400);

      prevValueRef.current = value;
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [value]);

  return (
    <span className={cn("transition-none", flashClass, className)}>
      {children}
    </span>
  );
}