import { useEffect, useRef, type InputHTMLAttributes } from "react";
import { Check, Minus } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  checkboxBoxClass,
  checkboxIconClass,
  checkboxInputClass,
  checkboxRootClass,
} from "./checkboxStyles";

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> & {
  rootClassName?: string;
  boxClassName?: string;
  iconClassName?: string;
  checkedClassName?: string;
  uncheckedClassName?: string;
  indeterminate?: boolean;
};

export function Checkbox({
  rootClassName,
  boxClassName,
  iconClassName,
  checkedClassName,
  uncheckedClassName,
  indeterminate = false,
  className,
  ...props
}: CheckboxProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <span className={cn(checkboxRootClass, rootClassName)}>
      <input
        ref={inputRef}
        type="checkbox"
        className={cn(checkboxInputClass, className)}
        {...props}
      />
      <span
        aria-hidden="true"
        className={cn(
          checkboxBoxClass(checkedClassName, uncheckedClassName),
          indeterminate && "border-primary bg-primary text-white",
          boxClassName,
        )}
      >
        {indeterminate ? (
          <Minus className={cn(checkboxIconClass, iconClassName)} />
        ) : (
          <Check className={cn(checkboxIconClass, iconClassName)} />
        )}
      </span>
    </span>
  );
}
