Set-Location c:/Users/HP/gps

$base = 'http://localhost:3001'
$vendorOk = 0
$vendorFail = 0
$foOk = 0
$foFail = 0
$vendorErrors = @()
$foErrors = @()

$allRows = @()
for ($i = 1; $i -le 30; $i++) {
  $vendor = if ($i -le 20) { 'FleetX' } else { 'WheelsEye' }
  $foIndex = (($i - 1) % 3) + 1
  $allRows += [PSCustomObject]@{
    requestId = ('TST-CNS-{0:000}' -f $i)
    city = 'Bengaluru'
    clientName = "Client $i"
    date = (Get-Date).ToString('yyyy-MM-dd')
    createdAt = (Get-Date).ToString('yyyy-MM-dd')
    serviceType = $vendor
    serviceCost = if ($vendor -eq 'FleetX') { 3000 } else { 2000 }
    vehicleNumber = ('KA-01-T-{0:0000}' -f $i)
    vehicleAvailabilityLocation = "Yard-$((($i % 5) + 1))"
    lpoNumber = ('LPO-{0:0000}' -f $i)
    lpoDate = (Get-Date).ToString('yyyy-MM-dd')
    lpoReferenceId = ('REF-{0:0000}' -f $i)
    lpoAdditional = "Batch test row $i"
    foEmail = "fo$foIndex@example.com"
    foName = "FO $foIndex"
  }
}

$vendorGroups = $allRows | Group-Object -Property serviceType
foreach ($group in $vendorGroups) {
  $vendorPayload = @{
    vendorName = $group.Name
    rows = @($group.Group | ForEach-Object {
      @{
        requestId = $_.requestId
        city = $_.city
        clientName = $_.clientName
        date = $_.date
        serviceType = $_.serviceType
        vehicleNumber = $_.vehicleNumber
        vehicleAvailabilityLocation = $_.vehicleAvailabilityLocation
        lpoNumber = $_.lpoNumber
        lpoDate = $_.lpoDate
        lpoReferenceId = $_.lpoReferenceId
        lpoAdditional = $_.lpoAdditional
      }
    })
  } | ConvertTo-Json -Depth 10

  try {
    $resp = Invoke-RestMethod -Method Post -Uri "$base/sendVendorBulkNotification" -ContentType 'application/json' -Body $vendorPayload
    if ($resp.success) {
      $vendorOk++
    } else {
      $vendorFail++
      $vendorErrors += "No success flag for vendor $($group.Name)"
    }
  } catch {
    $vendorFail++
    $vendorErrors += "Vendor $($group.Name): $($_.Exception.Message)"
  }
}

$foGroups = $allRows | Group-Object -Property foEmail
foreach ($group in $foGroups) {
  $foPayload = @{
    foEmail = $group.Name
    foName = $group.Group[0].foName
    rows = @($group.Group | ForEach-Object {
      @{
        requestId = $_.requestId
        city = $_.city
        clientName = $_.clientName
        createdAt = $_.createdAt
        serviceType = $_.serviceType
        serviceCost = $_.serviceCost
        vehicleNumber = $_.vehicleNumber
        vehicleAvailabilityLocation = $_.vehicleAvailabilityLocation
        lpoNumber = $_.lpoNumber
        lpoDate = $_.lpoDate
        lpoReferenceId = $_.lpoReferenceId
        lpoAdditional = $_.lpoAdditional
      }
    })
  } | ConvertTo-Json -Depth 10

  try {
    $resp = Invoke-RestMethod -Method Post -Uri "$base/sendFoBulkNotification" -ContentType 'application/json' -Body $foPayload
    if ($resp.success) {
      $foOk++
    } else {
      $foFail++
      $foErrors += "No success flag for FO $($group.Name)"
    }
  } catch {
    $foFail++
    $foErrors += "FO $($group.Name): $($_.Exception.Message)"
  }
}

[PSCustomObject]@{
  VendorGroupSuccess = $vendorOk
  VendorGroupFail    = $vendorFail
  FOGroupSuccess     = $foOk
  FOGroupFail        = $foFail
  TotalRowsGenerated = $allRows.Count
  VendorErrorSample = ($vendorErrors | Select-Object -First 5) -join ' | '
  FOErrorSample     = ($foErrors | Select-Object -First 5) -join ' | '
} | Format-List
