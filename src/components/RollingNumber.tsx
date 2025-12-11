"use client";

import { useEffect, useRef, useState } from "react";

interface RollingNumberProps {
  value: number;
  formatFn?: (value: number) => string;
  duration?: number;
}

export function RollingNumber({ value, formatFn = (v) => v.toString(), duration = 300 }: RollingNumberProps) {
  const [displayValue, setDisplayValue] = useState(value);
  const [isRolling, setIsRolling] = useState(false);
  const prevValueRef = useRef(value);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    if (value !== prevValueRef.current) {
      const startValue = prevValueRef.current;
      const endValue = value;

      // Skip animation if change is less than 0.1% (negligible change)
      const percentChange = Math.abs((endValue - startValue) / (startValue || 1)) * 100;
      if (percentChange < 0.1) {
        setDisplayValue(endValue);
        prevValueRef.current = endValue;
        return;
      }

      setIsRolling(true);
      const startTime = Date.now();

      const animate = () => {
        const now = Date.now();
        const progress = Math.min((now - startTime) / duration, 1);

        // Ease out cubic for snappy feel
        const easeOut = 1 - Math.pow(1 - progress, 3);
        const currentValue = startValue + (endValue - startValue) * easeOut;

        setDisplayValue(currentValue);

        if (progress < 1) {
          animationRef.current = requestAnimationFrame(animate);
        } else {
          setDisplayValue(endValue);
          setIsRolling(false);
          prevValueRef.current = endValue;
        }
      };

      animate();
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [value, duration]);

  return (
    <span className={isRolling ? "tabular-nums" : "tabular-nums"}>
      {formatFn(displayValue)}
    </span>
  );
}