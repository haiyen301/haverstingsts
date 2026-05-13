import type { InputHTMLAttributes } from "react";
import { Check } from "lucide-react";

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
};

export function Checkbox({
  rootClassName,
  boxClassName,
  iconClassName,
  checkedClassName,
  uncheckedClassName,
  className,
  ...props
}: CheckboxProps) {
  return (
    <span className={cn(checkboxRootClass, rootClassName)}>
      <input type="checkbox" className={cn(checkboxInputClass, className)} {...props} />
      <span
        aria-hidden="true"
        className={cn(
          checkboxBoxClass(checkedClassName, uncheckedClassName),
          boxClassName,
        )}
      >
        <Check className={cn(checkboxIconClass, iconClassName)} />
      </span>
    </span>
  );
}
