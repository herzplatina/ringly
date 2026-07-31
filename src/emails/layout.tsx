import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";

/**
 * The shell every Ringly email renders inside.
 *
 * Deliberately plain. These are transactional messages about money and service
 * interruptions — they need to read as a utility bill, not a newsletter, and
 * they need to survive Gmail's clipping and Outlook's rendering. No images, no
 * web fonts, no columns.
 */

const styles = {
  body: {
    backgroundColor: "#f6f6f6",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    margin: 0,
    padding: "24px 0",
  },
  container: {
    backgroundColor: "#ffffff",
    border: "1px solid #e6e6e6",
    borderRadius: "6px",
    margin: "0 auto",
    maxWidth: "560px",
    padding: "32px",
  },
  wordmark: {
    color: "#111111",
    fontSize: "18px",
    fontWeight: 700,
    letterSpacing: "-0.02em",
    margin: "0 0 24px",
  },
  heading: {
    color: "#111111",
    fontSize: "20px",
    fontWeight: 600,
    lineHeight: "28px",
    margin: "0 0 16px",
  },
  text: {
    color: "#333333",
    fontSize: "15px",
    lineHeight: "24px",
    margin: "0 0 16px",
  },
  hr: { borderColor: "#e6e6e6", margin: "24px 0" },
  footer: {
    color: "#777777",
    fontSize: "13px",
    lineHeight: "20px",
    margin: "0 0 8px",
  },
  link: { color: "#111111", textDecoration: "underline" },
} as const;

export const emailStyles = styles;

export type LayoutProps = {
  /** Shown in the inbox list beside the subject. Keep under ~90 characters. */
  preview: string;
  heading: string;
  children: ReactNode;
  /**
   * Transactional mail carries no unsubscribe link — a business cannot opt out
   * of being told its payment failed. Only the periodic digest may.
   */
  unsubscribable?: boolean;
};

export function EmailLayout({
  preview,
  heading,
  children,
  unsubscribable = false,
}: LayoutProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Text style={styles.wordmark}>Ringly</Text>
          <Text style={styles.heading}>{heading}</Text>
          <Section>{children}</Section>
          <Hr style={styles.hr} />
          <Text style={styles.footer}>
            Ringly — the AI receptionist for your business.{" "}
            <Link style={styles.link} href="{{DASHBOARD_URL}}">
              Open your dashboard
            </Link>
          </Text>
          {unsubscribable ? (
            <Text style={styles.footer}>
              You are receiving this because you asked for periodic reports.{" "}
              <Link style={styles.link} href="{{UNSUBSCRIBE_URL}}">
                Stop sending these
              </Link>
              .
            </Text>
          ) : (
            <Text style={styles.footer}>
              This is a service message about your Ringly account and cannot be
              unsubscribed from.
            </Text>
          )}
        </Container>
      </Body>
    </Html>
  );
}

/** Paragraph in the body copy voice. */
export function P({ children }: { children: ReactNode }) {
  return <Text style={styles.text}>{children}</Text>;
}

/** A labelled figure table — used for amounts, dates, and call stats. */
export function Facts({ rows }: { rows: Array<[string, string]> }) {
  return (
    <Section style={{ margin: "0 0 16px" }}>
      {rows.map(([label, value]) => (
        <Text
          key={label}
          style={{
            ...styles.text,
            borderBottom: "1px solid #f0f0f0",
            margin: 0,
            padding: "8px 0",
          }}
        >
          <span style={{ color: "#777777" }}>{label}</span>
          {"  "}
          <strong style={{ color: "#111111", float: "right" }}>{value}</strong>
        </Text>
      ))}
    </Section>
  );
}

/** The single action we want the reader to take. At most one per email. */
export function Cta({ href, label }: { href: string; label: string }) {
  return (
    <Section style={{ margin: "24px 0 8px" }}>
      <Link
        href={href}
        style={{
          backgroundColor: "#111111",
          borderRadius: "4px",
          color: "#ffffff",
          display: "inline-block",
          fontSize: "15px",
          fontWeight: 600,
          padding: "12px 20px",
          textDecoration: "none",
        }}
      >
        {label}
      </Link>
    </Section>
  );
}
