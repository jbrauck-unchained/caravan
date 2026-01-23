import { ReactNode } from "react";
import styles from "./Window.module.css";

interface WindowContentProps {
  children: ReactNode;
}

export function WindowContent({ children }: WindowContentProps) {
  return <div className={styles.content}>{children}</div>;
}
