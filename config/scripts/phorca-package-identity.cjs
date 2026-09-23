const { sanitizeFileName } = require('builder-util/out/filename')

const PHORCA_Q004_PLACEHOLDER = 'q004-placeholder'
const PHORCA_PACKAGE_IDENTITY = Object.freeze({
  appId: process.env.PHORCA_APP_ID || `com.phorca.${PHORCA_Q004_PLACEHOLDER}`,
  productName: process.env.PHORCA_PRODUCT_NAME || PHORCA_Q004_PLACEHOLDER
})

function getUnresolvedIdentityFields() {
  return Object.entries(PHORCA_PACKAGE_IDENTITY)
    .filter(([, value]) => value.includes(PHORCA_Q004_PLACEHOLDER))
    .map(([field]) => field)
}

function assertPhorcaIdentityResolved() {
  const unresolvedFields = getUnresolvedIdentityFields()
  if (unresolvedFields.length === 0) {
    return
  }
  const message = `[TODO(Q-004)] ${unresolvedFields.join(
    ', '
  )} still use the placeholder; refusing to package. Set PHORCA_ALLOW_PLACEHOLDER_IDENTITY=1 only for explicit local development.`
  if (process.env.PHORCA_ALLOW_PLACEHOLDER_IDENTITY !== '1') {
    throw new Error(message)
  }
  console.warn(
    `[TODO(Q-004)] ${unresolvedFields.join(
      ', '
    )} still use the placeholder; release packaging must provide the approved bundle and product identity.`
  )
}

function getPhorcaArtifactNames() {
  const prefix = sanitizeFileName(PHORCA_PACKAGE_IDENTITY.productName)
  return Object.freeze({
    windowsInstaller: `${prefix}-windows-setup`,
    macDmg: `${prefix}-macos`
  })
}

module.exports = {
  PHORCA_Q004_PLACEHOLDER,
  PHORCA_PACKAGE_IDENTITY,
  assertPhorcaIdentityResolved,
  getPhorcaArtifactNames,
  getUnresolvedIdentityFields
}
