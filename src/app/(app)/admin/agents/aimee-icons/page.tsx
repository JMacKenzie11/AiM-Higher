import { requireRole } from "@/lib/auth/current-user";
import { AIMEE_ICON_OPTIONS } from "@/components/aimee/AimeeIcons";
import styles from "./aimee-icons.module.css";

// A preview for choosing Aimee's icon (Jason, 2026-09-28: "all three
// options at real size, with the unread dot, in light and dark mode").
// System admins only, linked from nowhere; deleted once one is chosen.
//
// Dark mode is shown the way the app would draw it: a panel carrying
// data-theme="dark", so the brand tokens swap underneath exactly as
// they would across the whole app (brand/tokens.css).

function Button({ Icon, unread }: { Icon: (typeof AIMEE_ICON_OPTIONS)[number]["Icon"]; unread: boolean }) {
  return (
    <span className={styles.button} aria-label={unread ? "Aimee, 1 new" : "Aimee"} role="img">
      <Icon />
      {unread ? (
        <span className={styles.badge} aria-hidden="true">
          1
        </span>
      ) : null}
    </span>
  );
}

function Row({ theme }: { theme: "light" | "dark" }) {
  return (
    <div className={styles.panel} data-theme={theme === "dark" ? "dark" : undefined}>
      <p className={styles.panelLabel}>{theme === "dark" ? "Dark mode" : "Light mode"}</p>
      <div className={styles.grid}>
        {AIMEE_ICON_OPTIONS.map(({ key, name, Icon }) => (
          <figure key={key} className={styles.option}>
            <div className={styles.samples}>
              <Button Icon={Icon} unread={false} />
              <Button Icon={Icon} unread />
              <span className={styles.large} aria-hidden="true">
                <Icon size={88} />
              </span>
            </div>
            <figcaption className={styles.caption}>{name}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

export default async function AimeeIconsPage() {
  await requireRole(["system_admin"]);
  return (
    <div className={styles.page}>
      <h1 className={styles.h1}>Aimee&rsquo;s icon</h1>
      <p className={styles.intro}>
        Each option at 44px, the size of today&rsquo;s help button, then with one unread invitation, then at twice
        the size to show the detail.
      </p>
      <Row theme="light" />
      <Row theme="dark" />
    </div>
  );
}
