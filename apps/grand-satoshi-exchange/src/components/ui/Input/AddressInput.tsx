import { InputHTMLAttributes, useState, useEffect } from "react";
import { validateAddress, Network } from "@caravan/bitcoin";
import styles from "./Input.module.css";

interface AddressInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "type"> {
  label?: string;
  helpText?: string;
  value: string;
  onChange: (value: string) => void;
  network: Network;
  validateOnBlur?: boolean;
}

export function AddressInput({
  label,
  helpText,
  value,
  onChange,
  network,
  validateOnBlur = true,
  className = "",
  ...props
}: AddressInputProps) {
  const [error, setError] = useState<string>("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    // Only validate if touched and value is not empty
    if (touched && value && validateOnBlur) {
      try {
        const isValid = validateAddress(value, network);
        if (!isValid) {
          setError("Invalid Bitcoin address");
        } else {
          setError("");
        }
      } catch (err) {
        setError("Invalid Bitcoin address");
      }
    } else if (!value && touched) {
      setError("");
    }
  }, [value, network, touched, validateOnBlur]);

  const handleBlur = () => {
    setTouched(true);
  };

  return (
    <div className={styles.inputWrapper}>
      {label && <label className={styles.label}>{label}</label>}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={handleBlur}
        className={`${styles.input} ${styles.addressInput} ${
          error ? styles.error : touched && value && !error ? styles.valid : ""
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
