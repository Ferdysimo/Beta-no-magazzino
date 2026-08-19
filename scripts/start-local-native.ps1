param(
    [int]$BackendPort = 8001,
    [int]$FrontendPort = 3000,
    [int]$MongoPort = 27017
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$BackendDir = Join-Path $Root "backend"
$FrontendDir = Join-Path $Root "frontend"
$LogsDir = Join-Path $Root "logs"
$MongoDataDir = Join-Path $Root ".local-data\mongo"
$ToolsDir = Join-Path $Root ".local-tools"

New-Item -ItemType Directory -Force -Path $LogsDir, $MongoDataDir | Out-Null

function Test-PortOpen {
    param([int]$Port)
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $iar = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
        if (-not $iar.AsyncWaitHandle.WaitOne(500, $false)) { return $false }
        $client.EndConnect($iar)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

function Wait-PortOpen {
    param(
        [int]$Port,
        [int]$TimeoutSeconds
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        if (Test-PortOpen -Port $Port) { return $true }
        Start-Sleep -Seconds 1
    } while ((Get-Date) -lt $deadline)
    return $false
}

function Write-LocalEnv {
    $backendEnv = @"
MONGO_URL=mongodb://localhost:$MongoPort
DB_NAME=pastasciutta_local
JWT_SECRET=local-dev-only-change-in-production-0123456789abcdef
APP_ENV=development
ENABLE_API_DOCS=true
UPLOADS_DIR=$Root\uploads
"@
    Set-Content -Path (Join-Path $BackendDir ".env") -Value $backendEnv -Encoding ASCII

    $frontendEnv = @"
REACT_APP_BACKEND_URL=http://localhost:$BackendPort
BROWSER=none
HOST=0.0.0.0
PORT=$FrontendPort
CHOKIDAR_USEPOLLING=true
WATCHPACK_POLLING=true
"@
    Set-Content -Path (Join-Path $FrontendDir ".env") -Value $frontendEnv -Encoding ASCII
}

function Ensure-Mongo {
    if (Test-PortOpen -Port $MongoPort) {
        Write-Host "MongoDB gia attivo su $MongoPort"
        return
    }

    $mongod = Get-ChildItem -Path $ToolsDir -Recurse -Filter "mongod.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $mongod) {
        throw "mongod.exe non trovato sotto $ToolsDir. Scarica MongoDB Community Server 8.0 portable o usa LOCAL_NATIVE.md."
    }

    Start-Process `
        -FilePath $mongod.FullName `
        -ArgumentList @("--dbpath", $MongoDataDir, "--bind_ip", "127.0.0.1", "--port", "$MongoPort", "--logpath", (Join-Path $LogsDir "mongo.log"), "--logappend") `
        -WorkingDirectory $Root `
        -WindowStyle Hidden

    if (-not (Wait-PortOpen -Port $MongoPort -TimeoutSeconds 10)) {
        throw "MongoDB non e partito su $MongoPort. Controlla logs\mongo.log."
    }
}

function Ensure-Backend {
    $python = Join-Path $BackendDir ".venv\Scripts\python.exe"
    if (-not (Test-Path $python)) {
        throw "Virtualenv non trovato: $python. Crea il venv e installa requirements prima di avviare."
    }

    if (Test-PortOpen -Port $BackendPort) {
        Write-Host "Backend gia attivo su $BackendPort"
        return
    }

    Start-Process `
        -FilePath $python `
        -ArgumentList @("-m", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", "$BackendPort") `
        -WorkingDirectory $BackendDir `
        -RedirectStandardOutput (Join-Path $LogsDir "backend.out.log") `
        -RedirectStandardError (Join-Path $LogsDir "backend.err.log") `
        -WindowStyle Hidden

    if (-not (Wait-PortOpen -Port $BackendPort -TimeoutSeconds 15)) {
        throw "Backend non e partito su $BackendPort. Controlla logs\backend.err.log."
    }
}

function Ensure-Frontend {
    if (-not (Test-Path (Join-Path $FrontendDir "node_modules"))) {
        throw "node_modules non trovato nel frontend. Esegui: cd frontend; npx --yes yarn@1.22.22 install --frozen-lockfile"
    }

    if (Test-PortOpen -Port $FrontendPort) {
        Write-Host "Frontend gia attivo su $FrontendPort"
        return
    }

    $npx = (Get-Command npx.cmd -ErrorAction Stop).Source
    Start-Process `
        -FilePath $npx `
        -ArgumentList @("--yes", "yarn@1.22.22", "start") `
        -WorkingDirectory $FrontendDir `
        -RedirectStandardOutput (Join-Path $LogsDir "frontend.out.log") `
        -RedirectStandardError (Join-Path $LogsDir "frontend.err.log") `
        -WindowStyle Hidden

    if (-not (Wait-PortOpen -Port $FrontendPort -TimeoutSeconds 45)) {
        throw "Frontend non e partito su $FrontendPort. Controlla logs\frontend.err.log."
    }
}

Write-LocalEnv
Ensure-Mongo
Ensure-Backend
Ensure-Frontend

Write-Host ""
Write-Host "Ambiente locale nativo avviato:"
Write-Host "Frontend: http://localhost:$FrontendPort"
Write-Host "Backend:  http://localhost:$BackendPort/api/"
Write-Host "MongoDB:  mongodb://localhost:$MongoPort / pastasciutta_local"
