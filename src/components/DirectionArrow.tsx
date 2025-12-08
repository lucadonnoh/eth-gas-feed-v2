"use client";

import { useEffect, useRef, useState } from "react";

interface DirectionArrowProps {
  value: number;
  showDuration?: number;
}

export function DirectionArrow({ value, showDuration = 1000 }: DirectionArrowProps) {
  const [arrow, setArrow] = useState<"up" | "down" | null>(null);
  const prevValueRef = useRef(value);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (value !== prevValueRef.current) {
      // Clear any existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Set arrow direction
      if (value > prevValueRef.current) {
        setArrow("up");
      } else if (value < prevValueRef.current) {
        setArrow("down");
      }

      // Hide arrow after duration
      timeoutRef.current = setTimeout(() => {
        setArrow(null);
      }, showDuration);

      prevValueRef.current = value;
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [value, showDuration]);

  if (!arrow) return null;

  return (
    <span className={arrow === "up" ? "text-green-400" : "text-red-400"}>
      {arrow === "up" ? "▲" : "▼"}
    </span>
  );
}