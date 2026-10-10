export default function SettingsBreadcrumbs({ items }: { items: string[] }) {
  return <nav className="settings-breadcrumbs" aria-label="Settings location">
    <ol>{items.map((item, index) => <li key={index} aria-current={index === items.length - 1 ? 'page' : undefined}>{item}</li>)}</ol>
  </nav>
}
