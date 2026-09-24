import type React from 'react'
import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { Button } from '../ui/button'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSubsectionHeader } from './SettingsFormControls'
import { translate } from '@/i18n/i18n'

export function GeneralUpdateSettingsSection(): React.JSX.Element {
  const [appVersion, setAppVersion] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.updater.getVersion().then((version) => {
      if (!cancelled) {
        setAppVersion(version)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const openReleasesPage = (): void => {
    void window.api.updater.openReleasesPage().catch((error) => {
      console.error('[releases] Renderer bridge failed to open Releases page:', error)
    })
  }

  return (
    <section key="updates" className="space-y-4">
      <SettingsSubsectionHeader
        title={translate(
          'auto.components.settings.GeneralUpdateSettingsSection.f2b1ccc12',
          'Updates'
        )}
        description={translate(
          'auto.components.settings.GeneralUpdateSettingsSection.d91ebfb87e',
          'Current version: {{value0}}',
          { value0: appVersion ?? '...' }
        )}
      />
      <SearchableSetting
        title={translate(
          'auto.components.settings.GeneralUpdateSettingsSection.e1a647adc5',
          'Open Releases'
        )}
        description={translate(
          'auto.components.settings.GeneralUpdateSettingsSection.ceb579abaf',
          'Open the public Phorca Releases page to read release notes and download updates.'
        )}
        keywords={['update', 'version', 'release notes', 'download']}
        className="space-y-3"
      >
        <Button variant="outline" size="sm" onClick={openReleasesPage}>
          <ExternalLink className="size-3.5" />
          {translate(
            'auto.components.settings.GeneralUpdateSettingsSection.e1a647adc5',
            'Open Releases page'
          )}
        </Button>
      </SearchableSetting>
    </section>
  )
}
