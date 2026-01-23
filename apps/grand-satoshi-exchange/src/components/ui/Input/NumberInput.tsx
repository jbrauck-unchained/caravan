import { InputHTMLAttributes, ChangeEvent } from "react";
import styles from "./Input.module.css";

interface NumberInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "type"> {
  label?: string;
  error?: string;
  helpText?: string;
  value: string | number;
  onChange: (value: string) => void;
  allowDecimals?: boolean;
}

export function NumberInput({
  label,
  error,
  helpText,
  value,
  onChange,
  allowDecimals = false,
  className = "",
  ...props
}: NumberInputProps) {
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;

    // Allow empty string
    if (inputValue === "") {
      onChange("");
      return;
    }

    // Validate numeric input
    const pattern = allowDecimals ? /^\d*\.?\d*$/ : /^\d*$/;
    if (pattern.test(inputValue)) {
      onChange(inputValue);
    }
  };

  return (
    <div className={styles.inputWrapper}>
      {label && <label className={styles.label}>{label}</label>}
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={handleChange}
        className={`${styles.input} ${styles.numberInput} ${
          error ? styles.error : ""
        } ${className}`}
        {...props}
      />
      {error && <span className={styles.errorMessage}>{error}</span>}
      {!error && helpText && (
        <span className={styles.helpText}>{helpText}</span>
      )}
    </div>
  );
}
