; Bộ cài "Tool phá quản trị máy chấm công" (Digiplus) — Inno Setup 6.
; Cài TimMayChamCong.exe + SDK zkemkeeper vào máy, tạo shortcut, tự đăng ký SDK nếu máy chưa có.
; Build trong CI:  ISCC /DExe=<đường dẫn exe> /DZkSdk=<thư mục zksdk> /DAppVer=1.0.0 /DOutDir=<nơi xuất> ToolPhaQuanTri.iss

#ifndef AppVer
  #define AppVer "1.0.0"
#endif
#ifndef Exe
  #define Exe "..\..\..\TimMayChamCong\bin\Release\TimMayChamCong.exe"
#endif
#ifndef ZkSdk
  #define ZkSdk "..\installer\zksdk"
#endif
#ifndef OutDir
  #define OutDir "."
#endif

[Setup]
AppId={{7C3A9E42-6B51-4D8E-9A20-A1B2C3D4E5F6}}
AppName=Tool phá quản trị máy chấm công
AppVersion={#AppVer}
AppPublisher=Digiplus
DefaultDirName={autopf}\Digiplus\ToolPhaQuanTri
DefaultGroupName=Digiplus
DisableProgramGroupPage=yes
OutputDir={#OutDir}
OutputBaseFilename=ToolPhaQuanTri-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayName=Tool phá quản trị máy chấm công
UninstallDisplayIcon={app}\TimMayChamCong.exe

[Languages]
Name: "vi"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "{#Exe}"; DestDir: "{app}"; DestName: "TimMayChamCong.exe"; Flags: ignoreversion
Source: "{#ZkSdk}\*.dll"; DestDir: "{app}\zksdk"; Flags: ignoreversion

[Icons]
Name: "{group}\Tool phá quản trị máy chấm công"; Filename: "{app}\TimMayChamCong.exe"
Name: "{commondesktop}\Tool phá quản trị máy chấm công"; Filename: "{app}\TimMayChamCong.exe"

[Run]
; Đăng ký SDK zkemkeeper (COM 32-bit) — CHỈ khi máy chưa có SDK nào (máy đã cài Wise Eye / Ronald Jack / Digiplus thì giữ nguyên)
Filename: "{syswow64}\regsvr32.exe"; Parameters: "/s ""{app}\zksdk\zkemkeeper.dll"""; Check: NeedZkSdk; Flags: runhidden waituntilterminated; StatusMsg: "Đang đăng ký SDK máy chấm công..."
Filename: "{app}\TimMayChamCong.exe"; Description: "Mở Tool phá quản trị ngay"; Flags: postinstall nowait skipifsilent runascurrentuser

[UninstallRun]
Filename: "{syswow64}\regsvr32.exe"; Parameters: "/u /s ""{app}\zksdk\zkemkeeper.dll"""; Check: ZkSdkIsOurs; Flags: runhidden waituntilterminated; RunOnceId: "ToolPhaQuanTriZkSdk"

[Code]
// Đường dẫn DLL đang đăng ký cho zkemkeeper.ZKEM ở nhánh 32-bit ('' = máy chưa có SDK)
function ZkSdkPath(): String;
var Clsid: String;
begin
  Result := '';
  if RegQueryStringValue(HKCR32, 'zkemkeeper.ZKEM\CLSID', '', Clsid) and (Clsid <> '') then
    RegQueryStringValue(HKCR32, 'CLSID\' + Clsid + '\InprocServer32', '', Result);
end;
// Cần đăng ký khi: chưa có SDK, SDK cũ trỏ file đã mất, hoặc chính bản này đăng ký trước đó
function NeedZkSdk(): Boolean;
var P: String;
begin
  P := RemoveQuotes(ZkSdkPath());
  Result := (P = '') or (not FileExists(P)) or (Pos(Lowercase(ExpandConstant('{app}\zksdk\')), Lowercase(P)) = 1);
end;
function ZkSdkIsOurs(): Boolean;
begin
  Result := Pos(Lowercase(ExpandConstant('{app}\zksdk\')), Lowercase(RemoveQuotes(ZkSdkPath()))) = 1;
end;
