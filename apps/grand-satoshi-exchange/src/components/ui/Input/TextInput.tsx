import { InputHTMLAttributes } from "react";
import styles from "./Input.module.css";

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helpText?: string;
}

export function TextInput({
  label,
  error,
  helpText,
  className = "",
  ...props
}: TextInputProps) {
  return (
    <div className={styles.inputWrapper}>
      {label && <label className={styles.label}>{label}</label>}
      <input
        type="text"
        className={`${styles.input} ${error ? styles.error : ""} ${className}`}
        {...props}
      />
      {error && <span className={styles.errorMessage}>{error}</span>}
      {!error && helpText && (
        <span className={styles.helpText}>{helpText}</span>
      )}
    </div>
  );
}
