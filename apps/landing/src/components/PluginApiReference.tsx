import { useTranslation } from "react-i18next";
import type { DocsResource } from "../i18n";
import { CAPABILITIES, CAPABILITY_FAMILIES, RELEASED_APP_VERSION } from "../lib/plugin-capabilities";
import { PluginDocText } from "./PluginDocText";

/**
 * Every capability and method of the plugin API as static markup, rendered on
 * the server, so people and agents reading the page get the whole contract —
 * resolved signatures, docs, permissions, and the development and released
 * versions — without running the interactive explorer.
 */
export function PluginApiReference() {
  const { t, i18n } = useTranslation("docs");
  const copy = i18n.getResource(
    i18n.resolvedLanguage ?? i18n.language,
    "docs",
    "capabilityBrowser",
  ) as DocsResource["capabilityBrowser"];
  const declaration = t("explorer.declaration");
  return (
    <div className="plugin-api-reference">
      {CAPABILITY_FAMILIES.map((family) => (
        <section key={family} aria-labelledby={`api-${family}`}>
          <h3 id={`api-${family}`}>{copy.familyNames[family]}</h3>
          {CAPABILITIES.filter((entry) => entry.family === family && !entry.bundledOnly).map((entry) => (
            <section key={entry.key} id={`api-${entry.family}-${entry.id}`} aria-labelledby={`api-${entry.key}`}>
              <h4 id={`api-${entry.key}`}>
                <code>{entry.key}</code>
              </h4>
              <p>{copy.descriptions[entry.key.replace(":", "__") as keyof typeof copy.descriptions].purpose}</p>
              <ul>
                <li>{t("capabilityBrowser.developmentVersion", { version: entry.version })}</li>
                <li>
                  {entry.releasedVersion
                    ? t("capabilityBrowser.releasedVersion", {
                        app: RELEASED_APP_VERSION,
                        version: entry.releasedVersion,
                      })
                    : t("capabilityBrowser.notReleased", { app: RELEASED_APP_VERSION })}
                </li>
                <li>
                  {copy.permissionLabel}:{" "}
                  {entry.permissions.length ? (
                    entry.permissions.map((permission, index) => (
                      <span key={permission}>
                        {index ? " / " : null}
                        <code>{permission}</code>
                      </span>
                    ))
                  ) : (
                    <span>{copy.permissionFree}</span>
                  )}
                </li>
              </ul>
              {entry.methods.length ? (
                <dl>
                  {entry.methods.map((method) => (
                    <div key={method.path}>
                      <dt>
                        <code>{method.path}</code>
                      </dt>
                      <dd>
                        {method.signatures.map((signature) => (
                          <pre key={signature}>
                            <code>{signature}</code>
                          </pre>
                        ))}
                        {method.doc ? (
                          <p>
                            <PluginDocText text={method.doc} />
                          </p>
                        ) : null}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p>{declaration}</p>
              )}
            </section>
          ))}
        </section>
      ))}
    </div>
  );
}
