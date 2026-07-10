; Windows installer for Time Tracker.
;
; `deno desktop -o *.msi` is not used: the MSI it emits has no UI sequence (a
; ~500MB payload extracts behind a bare progress bar that looks hung), gives the
; Start Menu shortcut no icon, hardcodes ProductVersion 1.0.0 / Manufacturer
; "Deno", and never installs the Edge WebView2 runtime that the laufey webview
; backend requires. This script packages the same app directory instead.
;
;   ISCC /DMyAppVersion=1.2.3 scripts\win\installer.iss
;
; Expects, relative to the repo root:
;   dist\win\TimeTracker\             `deno task compile:win`
;   dist\win\MicrosoftEdgeWebview2Setup.exe   evergreen bootstrapper

#define MyAppName "Time Tracker"
#define MyAppExeName "TimeTracker.exe"
#define MyAppPublisher "Rafiul Awal"
#define MyAppURL "https://github.com/rafi0x/time-tracker"
#define RepoRoot "..\.."

#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif

[Setup]
AppId={{7C4F2E13-9B5A-4C2D-8F6E-3A1D0B7C5E92}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
VersionInfoVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}/issues
AppUpdatesURL={#MyAppURL}/releases

; Per-user install under %LocalAppData%\Programs so no UAC prompt is needed and
; the app can write next to its own binary (laufey drops .update-ok there).
; "Install for all users" is still reachable from the privileges dialog.
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
UninstallDisplayName={#MyAppName}
UninstallDisplayIcon={app}\{#MyAppExeName}

ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64

OutputDir={#RepoRoot}\dist
OutputBaseFilename=TimeTracker-Setup
SetupIconFile={#RepoRoot}\icons\app.ico
WizardStyle=modern

; The payload is a few hundred MB of Next.js server + node_modules. Solid LZMA2
; roughly halves it versus the MSI cab, and the wizard shows real progress.
Compression=lzma2/max
SolidCompression=yes

; Replace a running instance rather than failing with locked files.
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#RepoRoot}\dist\win\TimeTracker\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#RepoRoot}\dist\win\MicrosoftEdgeWebview2Setup.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall; Check: not WebView2Installed

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\AppIcon.ico"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\AppIcon.ico"; Tasks: desktopicon

[Run]
Filename: "{tmp}\MicrosoftEdgeWebview2Setup.exe"; Parameters: "/silent /install"; StatusMsg: "Installing Microsoft Edge WebView2 Runtime..."; Check: not WebView2Installed
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[Code]
const
  { Evergreen WebView2 Runtime, as registered by EdgeUpdate. }
  WebView2ClientKey = 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

function HasVersionValue(RootKey: Integer): Boolean;
var
  Version: String;
begin
  Result := RegQueryStringValue(RootKey, WebView2ClientKey, 'pv', Version)
    and (Version <> '') and (Version <> '0.0.0.0');
end;

{ Per-machine installs land in the 32-bit registry view even on x64, so both
  views are checked, plus the per-user location. }
function WebView2Installed: Boolean;
begin
  Result := HasVersionValue(HKLM32) or HasVersionValue(HKLM64)
    or HasVersionValue(HKCU);
end;
