; Trình cài đặt Digiplus Chấm Công (kiểu Next-Next) — biên dịch bằng Inno Setup 6:
;   ISCC /DSrc="<thư mục dist>\DigiplusChamCong" /DAppVer=1.15.66 /DOutDir="<nơi xuất>" tools\installer\DigiplusSetup.iss
; Một file Setup.exe dùng cho MỌI khách:
;   - Bản có tên miền: hỏi tên khách + mật khẩu cấp domain → tự lấy config.txt từ máy chủ; khách CHƯA có thì hỏi xác nhận rồi
;     TẠO MỚI tên miền ngay
;   - Bản LAN: không cần tên khách / mật khẩu
;   - Cả 2 kiểu đều có trang CHỌN CỔNG: gõ cổng hoặc bấm "Tự chọn cổng trống"; cổng trùng (chương trình khác đang dùng /
;     bản Digiplus khác trên máy) thì báo + gợi ý cổng trống. Khách cũ đổi cổng → máy chủ trỏ tên miền về cổng mới.
;   - Cài đè lên bản đang có: mặc định GIỮ cấu hình + dữ liệu cũ
;   - NHIỀU BẢN TRÊN 1 MÁY (VPS nhiều khách): máy đã có bản Digiplus thì trình cài hỏi "cập nhật bản nào" hay "cài thêm bản mới";
;     mỗi bản một AppId riêng (hậu tố -2, -3...) → mỗi bản một thư mục, một mục gỡ cài đặt, một lối tắt.
; Cài im lặng: thêm /INSTANCE=2 để chỉ định bản (bỏ trống = bản đầu tiên).
; Cài im lặng (thử nghiệm/tự động): /VERYSILENT /MODE=lan|domain|keep /PORT=8686|auto /SLUG=... /PASS=... /CREATE=1 /DEVICE=1 /PHONE=1 /SKIPAUTO=1 /DIR="..."
;   (/PORT=auto = tự lấy cổng trống đầu tiên từ 8686; tạo khách mới im lặng mà không ghi /PORT cũng tự lấy cổng trống)

#ifndef Src
  #define Src "..\..\dist-khach\DigiplusChamCong"
#endif
#ifndef AppVer
  #define AppVer "1.0.0"
#endif
#ifndef OutDir
  #define OutDir "..\..\dist-setup"
#endif
#define ApiUrl "https://huongdan.maychamcongcloud.com/api/tao-domain"

[Setup]
AppId={code:GetAppId}
UsePreviousLanguage=no
AppName=Digiplus Chấm Công
AppVersion={#AppVer}
AppPublisher=Digiplus
AppPublisherURL=https://digiplus.vn
DefaultDirName={code:DefDir}
DisableProgramGroupPage=yes
DisableReadyPage=no
DirExistsWarning=no
UsePreviousAppDir=yes
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=commandline
OutputDir={#OutDir}
OutputBaseFilename=DigiplusChamCong-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupIconFile=digiplus.ico
UninstallDisplayIcon={app}\digiplus.ico
CloseApplications=no
UninstallDisplayName={code:DispName}
VersionInfoVersion={#AppVer}
VersionInfoCompany=Digiplus
VersionInfoDescription=Trình cài đặt Digiplus Chấm Công

[Messages]
SetupWindowTitle=Cài đặt %1
WelcomeLabel1=Cài đặt Digiplus Chấm Công
WelcomeLabel2=Trình cài đặt sẽ đưa phần mềm chấm công [name/ver] vào máy tính này và tự bật phần mềm mỗi khi mở máy.%n%nNên đóng các chương trình khác trước khi tiếp tục.
ButtonNext=&Tiếp tục >
ButtonBack=< &Quay lại
ButtonInstall=&Cài đặt
ButtonCancel=Huỷ
ButtonFinish=&Hoàn tất
ButtonBrowse=&Chọn...
WizardSelectDir=Chọn thư mục cài đặt
SelectDirDesc=Phần mềm sẽ được cài vào đâu?
SelectDirLabel3=Trình cài đặt sẽ cài [name] vào thư mục dưới đây.
SelectDirBrowseLabel=Bấm Tiếp tục để cài vào thư mục này. Muốn chọn thư mục khác, bấm Chọn.
WizardReady=Sẵn sàng cài đặt
ReadyLabel1=Trình cài đặt đã sẵn sàng cài [name] vào máy tính này.
ReadyLabel2a=Bấm Cài đặt để bắt đầu, hoặc Quay lại nếu muốn xem/sửa lựa chọn.
WizardInstalling=Đang cài đặt
InstallingLabel=Vui lòng chờ trong lúc [name] được cài vào máy tính.
FinishedHeadingLabel=Đã cài xong Digiplus Chấm Công
FinishedLabelNoIcons=Phần mềm đã được cài và đang chạy trên máy tính này.
FinishedLabel=Phần mềm đã được cài và đang chạy trên máy tính này.
ClickFinish=Bấm Hoàn tất để đóng trình cài đặt.
ExitSetupTitle=Thoát cài đặt
ExitSetupMessage=Chưa cài xong. Nếu thoát bây giờ, phần mềm sẽ không được cài.%n%nBạn có thể chạy lại trình cài đặt lúc khác.%n%nThoát cài đặt?
StatusExtractFiles=Đang chép tệp...
StatusRunProgram=Đang hoàn tất cài đặt...

[Files]
; config.txt: KHÔNG ghi đè cấu hình khách đang có; bản mới (nếu chọn) do phần [Code] ghi TRƯỚC khi chép tệp
Source: "{#Src}\config.txt"; DestDir: "{app}"; Flags: onlyifdoesntexist
Source: "{#Src}\*"; DestDir: "{app}"; Excludes: "config.txt"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "digiplus.ico"; DestDir: "{app}"; Flags: ignoreversion

[InstallDelete]
Type: files; Name: "{autodesktop}\Digiplus Cham Cong.url"
Type: files; Name: "{autodesktop}\Digiplus Cham Cong {code:InstNum}.url"

[Run]
; Đăng ký tự bật khi mở máy + khởi động phần mềm + chờ phần mềm sẵn sàng (CaiDat.bat chế độ im lặng)
Filename: "{app}\CaiDat.bat"; Parameters: "silent{code:AutoParam}"; WorkingDir: "{app}"; Flags: runhidden waituntilterminated; StatusMsg: "Đang khởi động phần mềm (lần đầu có thể mất khoảng 1 phút)..."
Filename: "{code:AdminUrl}"; Description: "Mở trang quản lý Digiplus Chấm Công"; Flags: postinstall shellexec nowait skipifsilent

[UninstallRun]
Filename: "{app}\GoCaiDat.bat"; Parameters: "silent"; WorkingDir: "{app}"; Flags: runhidden waituntilterminated; RunOnceId: "DigiplusStop"

[UninstallDelete]
Type: files; Name: "{autodesktop}\{code:ShortcutName}"

[Code]
const
  MODE_KEEP = 0;
  MODE_DOMAIN = 1;
  MODE_LAN = 2;

var
  ModePage: TInputOptionWizardPage;
  DomainPage: TInputQueryWizardPage;
  ChkDevice, ChkPhone: TNewCheckBox;   { chỉ áp dụng khi TẠO khách mới }
  PortPage: TInputQueryWizardPage;    { trang chọn cổng (dùng cho cả bản LAN lẫn bản tên miền) }
  BtnAutoPort: TNewButton;
  LblPort: TNewStaticText;
  PortCtx: String;        { kiểu + tên khách lúc điền sẵn cổng — đổi thì điền lại }
  DomainIsNew: Boolean;   { khách chưa có trên máy chủ → tạo mới ở trang cổng }
  DomainCfg, DomainPort: String;   { cấu hình + cổng của khách đã có (lấy từ máy chủ) }
  NewConfig: String;      { nội dung config.txt sẽ ghi ('' = giữ cấu hình cũ) }
  HasOldConfig: Boolean;

  Instance: String;       { '' = bản đầu tiên; '2', '3'... = các bản cài thêm trên cùng máy }

const
  FETCH_EXISTING = 0;   { chỉ lấy cấu hình khách đã có }
  FETCH_CREATE = 1;     { tạo khách mới với cổng đã chọn }
  FETCH_SETPORT = 2;    { khách đã có, đổi sang cổng mới }
  BASE_ID = '{6C6B0B7E-4F0B-4B43-9C2A-D1G1PLU5CC01}';
  UNINS_ROOT = 'Software\Microsoft\Windows\CurrentVersion\Uninstall';

function ReadCfg(const FileName, Key: String): String; forward;

function InstSuffix: String;
begin
  if Instance = '' then Result := '' else Result := '-' + Instance;
end;

function GetAppId(Param: String): String;
begin
  Result := BASE_ID + InstSuffix;
end;

function DefDir(Param: String): String;
begin
  Result := ExpandConstant('{sd}\DigiplusChamCong') + InstSuffix;
end;

function InstNum(Param: String): String;
begin
  if Instance = '' then Result := '0' else Result := Instance;
end;

{ Tên lối tắt ngoài Desktop: bản đầu tiên "Digiplus Chấm Công"; bản cài thêm kèm tên khách hoặc cổng để phân biệt }
function ShortcutName(Param: String): String;
var Cust, Port: String;
begin
  Result := 'Digiplus Chấm Công';
  if Instance <> '' then begin
    Cust := ReadCfg(AddBackslash(WizardDirValue) + 'config.txt', 'CUSTOMER');
    Port := ReadCfg(AddBackslash(WizardDirValue) + 'config.txt', 'PORT');
    if Cust <> '' then Result := Result + ' - ' + Cust
    else if Port <> '' then Result := Result + ' - cổng ' + Port
    else Result := Result + ' ' + Instance;
  end;
  Result := Result + '.url';
end;

{ Tên hiện trong danh sách gỡ cài đặt: kèm tên khách hoặc cổng để phân biệt các bản }
function DispName(Param: String): String;
var Cust, Port: String;
begin
  Cust := ReadCfg(ExpandConstant('{app}\config.txt'), 'CUSTOMER');
  Port := ReadCfg(ExpandConstant('{app}\config.txt'), 'PORT');
  Result := 'Digiplus Chấm Công';
  if Cust <> '' then Result := Result + ' (' + Cust + ')'
  else if (Instance <> '') and (Port <> '') then Result := Result + ' (cổng ' + Port + ')';
end;

{ Đọc thư mục cài của 1 bản đã có (tìm ở cả HKLM lẫn HKCU). Trả '' nếu bản đó chưa cài. }
function InstalledDir(const Inst: String): String;
var Key, Sfx: String;
begin
  Result := '';
  if Inst = '' then Sfx := '' else Sfx := '-' + Inst;
  Key := UNINS_ROOT + '\' + BASE_ID + Sfx + '_is1';
  if not RegQueryStringValue(HKLM, Key, 'InstallLocation', Result) then
    if not RegQueryStringValue(HKCU, Key, 'InstallLocation', Result) then Result := '';
end;

function InstLabel(const Inst: String): String;
var Dir, Cust, Port: String;
begin
  Dir := InstalledDir(Inst);
  Cust := ReadCfg(AddBackslash(Dir) + 'config.txt', 'CUSTOMER');
  Port := ReadCfg(AddBackslash(Dir) + 'config.txt', 'PORT');
  Result := RemoveBackslash(Dir);
  if Cust <> '' then Result := Result + '  (khách ' + Cust + ', cổng ' + Port + ')'
  else if Port <> '' then Result := Result + '  (cổng ' + Port + ')';
end;

{ Trước khi hiện trình cài: máy đã có bản nào chưa → cập nhật bản đó hay cài thêm bản mới }
function InitializeSetup: Boolean;
var I, N, Free: Integer; Found: array of String; Txt, Inst: String;
begin
  Result := True;
  Instance := ExpandConstant('{param:INSTANCE|}');
  if WizardSilent or (Instance <> '') then Exit;   { cài im lặng / đã chỉ định bản: không hỏi }

  N := 0; Free := 0; SetArrayLength(Found, 30);
  for I := 1 to 30 do begin
    if I = 1 then Inst := '' else Inst := IntToStr(I);
    if InstalledDir(Inst) <> '' then begin Found[N] := Inst; N := N + 1; end
    else if (Free = 0) and (I > 1) then Free := I;
  end;
  if N = 0 then Exit;                               { máy chưa có bản nào → cài bản đầu tiên như thường }
  if Free = 0 then Free := 31;

  { Hỏi lần lượt từng bản đang có: CÓ = cập nhật bản đó; KHÔNG = sang bản kế; hết danh sách = cài thêm bản mới }
  for I := 0 to N - 1 do begin
    if I < N - 1 then Txt := 'KHÔNG = xem bản tiếp theo.'
    else Txt := 'KHÔNG = cài THÊM một bản mới cho khách khác (VPS chạy nhiều khách).';
    case MsgBox('Máy này đã có Digiplus Chấm Công (bản ' + IntToStr(I + 1) + '/' + IntToStr(N) + ') tại:' + #13#10 + '    ' + InstLabel(Found[I]) + #13#10 + #13#10 +
                'CÓ = cập nhật / cài lại bản này (giữ nguyên dữ liệu).' + #13#10 + Txt, mbConfirmation, MB_YESNOCANCEL) of
      IDYES: begin Instance := Found[I]; Exit; end;
      IDNO: ;
    else
      begin Result := False; Exit; end;
    end;
  end;
  Instance := IntToStr(Free);
end;

function Param(const Name, Def: String): String;
begin
  Result := ExpandConstant('{param:' + Name + '|' + Def + '}');
end;

function OldConfigPath: String;
begin
  Result := AddBackslash(WizardDirValue) + 'config.txt';
end;

{ Đọc 1 khoá trong config.txt (dạng KEY=VALUE) }
function ReadCfg(const FileName, Key: String): String;
var Lines: TArrayOfString; I: Integer; L: String;
begin
  Result := '';
  if not LoadStringsFromFile(FileName, Lines) then Exit;
  for I := 0 to GetArrayLength(Lines) - 1 do begin
    L := Trim(Lines[I]);
    if Pos(Uppercase(Key) + '=', Uppercase(L)) = 1 then begin
      Result := Trim(Copy(L, Length(Key) + 2, MaxInt));
      Exit;
    end;
  end;
end;

function CurrentPort: String;
begin
  if NewConfig <> '' then Result := ReadCfg(ExpandConstant('{app}\config.txt'), 'PORT')
  else Result := ReadCfg(ExpandConstant('{app}\config.txt'), 'PORT');
  if Result = '' then Result := '8686';
end;

function AdminUrl(Param: String): String;
begin
  Result := 'http://localhost:' + CurrentPort + '/admin';
end;

function AutoParam(Param: String): String;
begin
  if ExpandConstant('{param:SKIPAUTO|0}') = '1' then Result := ' noauto' else Result := '';
end;

function JsonEsc(const S: String): String;
begin
  Result := S;
  StringChangeEx(Result, '\', '\\', True);
  StringChangeEx(Result, '"', '\"', True);
end;

function ValidSlug(const S: String): Boolean;
var I: Integer; C: Char;
begin
  Result := (Length(S) >= 1) and (Length(S) <= 42);
  for I := 1 to Length(S) do begin
    C := S[I];
    if not (((C >= 'a') and (C <= 'z')) or ((C >= '0') and (C <= '9')) or (C = '-')) then Result := False;
  end;
  if Result then Result := (S[1] <> '-') and (S[Length(S)] <> '-');
end;

{ Lấy config.txt của khách ĐÃ tạo từ máy chủ Digiplus. Err = thông báo cho người cài khi thất bại. }
function BoolJson(B: Boolean): String;
begin
  if B then Result := 'true' else Result := 'false';
end;

{ Đọc 1 khoá KEY=VALUE trong nội dung config (chuỗi nhiều dòng) }
function CfgVal(const Text, Key: String): String;
var S, L: String; P: Integer;
begin
  Result := '';
  S := Text;
  StringChangeEx(S, #13, '', True);
  while S <> '' do begin
    P := Pos(#10, S);
    if P = 0 then begin L := S; S := ''; end
    else begin L := Copy(S, 1, P - 1); Delete(S, 1, P); end;
    L := Trim(L);
    if Pos(Uppercase(Key) + '=', Uppercase(L)) = 1 then begin Result := Trim(Copy(L, Length(Key) + 2, MaxInt)); Exit; end;
  end;
end;

{ Lấy số của 1 trường trong JSON trả về (vd "nextPort":8690) }
function JsonNum(const S, Key: String): String;
var P: Integer;
begin
  Result := '';
  P := Pos('"' + Key + '":', S);
  if P = 0 then Exit;
  P := P + Length(Key) + 3;
  while (P <= Length(S)) and (S[P] >= '0') and (S[P] <= '9') do begin Result := Result + S[P]; P := P + 1; end;
end;

{ Kind: FETCH_EXISTING = chỉ lấy cấu hình khách đã có (NotFound=True nếu chưa có); FETCH_CREATE = tạo khách mới với cổng Port;
  FETCH_SETPORT = khách đã có, đổi sang cổng Port. }
function FetchConfig(const Slug, Pass: String; Kind: Integer; const Port: String; UseDevice, UsePhone: Boolean; var Cfg, Err: String; var NotFound: Boolean): Boolean;
var W: Variant; St: Integer; Body, NP: String;
begin
  Result := False; Cfg := ''; Err := ''; NotFound := False;
  Body := '{"pass":"' + JsonEsc(Pass) + '","slug":"' + JsonEsc(Slug) + '","plain":true,';
  case Kind of
    FETCH_CREATE: Body := Body + '"port":' + Port + ',"localPort":true,"mode":"office","useDevice":' + BoolJson(UseDevice) + ',"usePhone":' + BoolJson(UsePhone) + '}';
    FETCH_SETPORT: Body := Body + '"onlyExisting":true,"setPort":true,"port":' + Port + '}';
  else
    Body := Body + '"onlyExisting":true}';
  end;
  try
    W := CreateOleObject('WinHttp.WinHttpRequest.5.1');
    W.SetTimeouts(15000, 15000, 30000, 60000);
    W.Open('POST', '{#ApiUrl}', False);
    W.SetRequestHeader('Content-Type', 'application/json');
    W.Send(Body);
    St := W.Status;
    if St = 200 then begin
      Cfg := W.ResponseText;
      if Pos('TUNNEL_TOKEN=', Cfg) = 0 then Err := 'Máy chủ trả về cấu hình không hợp lệ. Thử lại sau ít phút.'
      else if (Kind <> FETCH_EXISTING) and (CfgVal(Cfg, 'PORT') <> Port) then
        Err := 'Máy chủ Digiplus chưa nhận cổng ' + Port + ' (vẫn trả cổng ' + CfgVal(Cfg, 'PORT') + '). Thử lại sau vài phút.'
      else Result := True;
    end
    else if St = 401 then Err := 'Sai mật khẩu cấp domain.'
    else if St = 404 then begin NotFound := True; Err := 'Chưa có khách "' + Slug + '".'; end
    else if St = 403 then Err := 'Đã hết hạn mức số tên miền được tạo. Liên hệ quản trị Digiplus.'
    else if St = 409 then begin
      NP := JsonNum(W.ResponseText, 'nextPort');
      Err := 'Cổng ' + Port + ' đã cấp cho khách khác trên máy chủ Digiplus.';
      if NP <> '' then Err := Err + ' Gõ cổng khác (gợi ý: ' + NP + ') rồi bấm Tiếp tục.';
    end
    else if St = 400 then Err := 'Tên khách không hợp lệ (chỉ chữ thường, số, gạch ngang; ví dụ: congtyabc).'
    else Err := 'Máy chủ báo lỗi (mã ' + IntToStr(St) + '). Thử lại sau ít phút.';
  except
    Err := 'Không kết nối được máy chủ Digiplus. Kiểm tra Internet của máy này rồi thử lại.' + #13#10 + GetExceptionMessage;
  end;
end;

function LanConfig(const Port: String): String;
begin
  Result := 'PORT=' + Port + #13#10 + 'CUSTOMER=' + #13#10 + 'TUNNEL_TOKEN=' + #13#10 + 'USE_DEVICE=1' + #13#10 + 'USE_PHONE=1' + #13#10;
end;

function ValidPort(const S: String): Boolean;
var N: Integer;
begin
  N := StrToIntDef(Trim(S), 0);
  Result := (N >= 1024) and (N <= 65000);
end;

{ Các cổng đang có chương trình nghe trên máy này, dạng ",80,443,8686," (1 lần gọi PowerShell cho mọi cổng).
  Máy không có Get-NetTCPConnection (Win7) thì đọc netstat: dòng nghe có địa chỉ đối tác :0, không phụ thuộc ngôn ngữ Windows. }
function ListenPorts: String;
var RC: Integer; Ps, Outf: String; S: AnsiString;
begin
  Result := ',';
  Ps := ExpandConstant('{tmp}\dgp-ports.ps1');
  Outf := ExpandConstant('{tmp}\dgp-ports.txt');
  DeleteFile(Outf);
  SaveStringToFile(Ps,
    'try { $p = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | ForEach-Object { $_.LocalPort }) }' + #13#10 +
    'catch { $p = @(netstat -an | ForEach-Object { if ($_ -match ''^\s*TCP\s+\S+:(\d+)\s+\S+:0\s'') { $matches[1] } }) }' + #13#10 +
    'Set-Content -Path $args[0] -Value ('','' + (($p | Sort-Object -Unique) -join '','') + '','') -Encoding Ascii' + #13#10, False);
  if Exec('powershell.exe', '-NoProfile -ExecutionPolicy Bypass -File "' + Ps + '" "' + Outf + '"', '', SW_HIDE, ewWaitUntilTerminated, RC) then
    if LoadStringFromFile(Outf, S) then Result := Trim(String(S));
  if Result = '' then Result := ',';
end;

{ Cổng đã ghi trong config.txt của MỘT BẢN DIGIPLUS KHÁC trên máy này (kể cả bản đang tắt) → mô tả bản đó, '' nếu không }
function PortOwner(const Port: String): String;
var I: Integer; Inst, Dir: String;
begin
  Result := '';
  for I := 1 to 30 do begin
    if I = 1 then Inst := '' else Inst := IntToStr(I);
    Dir := InstalledDir(Inst);
    if (Dir <> '') and (CompareText(RemoveBackslash(Dir), RemoveBackslash(WizardDirValue)) <> 0) and
       (ReadCfg(AddBackslash(Dir) + 'config.txt', 'PORT') = Port) then begin
      Result := 'đã dùng cho bản Digiplus khác trên máy này: ' + InstLabel(Inst);
      Exit;
    end;
  end;
end;

{ '' = cổng dùng được; ngược lại là lý do bị trùng. Cổng của chính bản đang cập nhật thì không tính (sẽ tắt trước khi chép). }
function PortProblem(const Port, Listen: String): String;
begin
  Result := PortOwner(Port);
  if (Result = '') and (Port <> ReadCfg(OldConfigPath, 'PORT')) and (Pos(',' + Port + ',', Listen) > 0) then
    Result := 'đang có chương trình khác dùng trên máy này';
end;

{ Cổng trống đầu tiên từ Start trở lên }
function FindFreePort(Start: Integer): String;
var P: Integer; L: String;
begin
  L := ListenPorts;
  Result := IntToStr(Start);
  for P := Start to Start + 500 do
    if (P <= 65000) and (PortProblem(IntToStr(P), L) = '') then begin Result := IntToStr(P); Exit; end;
end;

procedure ShowPortStatus;
var P, Why: String;
begin
  P := Trim(PortPage.Values[0]);
  if not ValidPort(P) then begin LblPort.Caption := ''; Exit; end;
  LblPort.Font.Color := clGray; LblPort.Caption := 'Đang kiểm tra cổng ' + P + '...'; WizardForm.Refresh;
  Why := PortProblem(P, ListenPorts);
  if Why = '' then begin
    LblPort.Font.Color := $00007A00; LblPort.Caption := 'Cổng ' + P + ' đang trống, dùng được.';
  end else begin
    LblPort.Font.Color := clRed; LblPort.Caption := 'Cổng ' + P + ' ' + Why + '. Bấm "Tự chọn cổng trống" hoặc gõ cổng khác.';
  end;
end;

procedure AutoPortClick(Sender: TObject);
var P: String;
begin
  LblPort.Font.Color := clGray; LblPort.Caption := 'Đang tìm cổng trống...'; WizardForm.Refresh;
  P := FindFreePort(8686);
  PortPage.Values[0] := P;
  LblPort.Font.Color := $00007A00; LblPort.Caption := 'Cổng ' + P + ' đang trống, dùng được.';
end;

procedure PortEditChange(Sender: TObject);
begin
  LblPort.Caption := '';
end;

procedure InitializeWizard;
begin
  ModePage := CreateInputOptionPage(wpSelectDir, 'Kiểu cài đặt', 'Chọn cách phần mềm sẽ chạy trên máy này',
    'Chọn một kiểu rồi bấm Tiếp tục.', True, False);
  ModePage.Add('Giữ cấu hình đang có trên máy này (cập nhật / cài lại, giữ nguyên dữ liệu)');
  ModePage.Add('Bản có tên miền — xem được từ xa qua Internet (nhập tên khách + mật khẩu)');
  ModePage.Add('Bản LAN — chỉ dùng trong mạng nội bộ, không cần tên miền');

  DomainPage := CreateInputQueryPage(ModePage.ID, 'Thông tin khách', 'Bản có tên miền',
    'Nhập tên khách (viết liền không dấu) và mật khẩu cấp domain. Khách chưa có sẽ được tạo mới. Hai ô chọn bên dưới chỉ áp dụng khi tạo khách mới. Máy này cần có Internet.');
  DomainPage.Add('Tên khách (ví dụ: congtyabc):', False);
  DomainPage.Add('Mật khẩu cấp domain:', True);
  ChkDevice := TNewCheckBox.Create(DomainPage);
  ChkDevice.Parent := DomainPage.Surface;
  ChkDevice.Top := DomainPage.Edits[1].Top + DomainPage.Edits[1].Height + ScaleY(18);
  ChkDevice.Width := DomainPage.SurfaceWidth; ChkDevice.Height := ScaleY(20);
  ChkDevice.Caption := 'Khách dùng máy chấm công (vân tay / khuôn mặt)';
  ChkDevice.Checked := True;
  ChkPhone := TNewCheckBox.Create(DomainPage);
  ChkPhone.Parent := DomainPage.Surface;
  ChkPhone.Top := ChkDevice.Top + ScaleY(24);
  ChkPhone.Width := DomainPage.SurfaceWidth; ChkPhone.Height := ScaleY(20);
  ChkPhone.Caption := 'Khách chấm công bằng điện thoại (chụp ảnh + định vị)';
  ChkPhone.Checked := True;

  PortPage := CreateInputQueryPage(DomainPage.ID, 'Cổng phần mềm', 'Chọn cổng cho phần mềm trên máy này',
    'Phần mềm chạy tại http://localhost:<cổng>/admin. Mỗi bản Digiplus trên cùng một máy cần một cổng riêng. Không rõ thì bấm "Tự chọn cổng trống".');
  PortPage.Add('Cổng (1024–65000):', False);
  PortPage.Edits[0].Anchors := [akLeft, akTop];
  PortPage.Edits[0].Width := ScaleX(110);
  PortPage.Edits[0].OnChange := @PortEditChange;
  BtnAutoPort := TNewButton.Create(PortPage);
  BtnAutoPort.Parent := PortPage.Surface;
  BtnAutoPort.Caption := 'Tự chọn cổng trống';
  BtnAutoPort.Left := PortPage.Edits[0].Left + PortPage.Edits[0].Width + ScaleX(10);
  BtnAutoPort.Top := PortPage.Edits[0].Top - ScaleY(2);
  BtnAutoPort.Width := ScaleX(160);
  BtnAutoPort.Height := PortPage.Edits[0].Height + ScaleY(4);
  BtnAutoPort.OnClick := @AutoPortClick;
  LblPort := TNewStaticText.Create(PortPage);
  LblPort.Parent := PortPage.Surface;
  LblPort.Left := PortPage.Edits[0].Left;
  LblPort.Top := PortPage.Edits[0].Top + PortPage.Edits[0].Height + ScaleY(14);
  LblPort.AutoSize := False;
  LblPort.WordWrap := True;
  LblPort.Width := PortPage.SurfaceWidth - LblPort.Left;
  LblPort.Height := ScaleY(54);
  LblPort.Caption := '';
end;

procedure CurPageChanged(CurPageID: Integer);
var Ctx, Slug: String;
begin
  if CurPageID = ModePage.ID then begin
    HasOldConfig := FileExists(OldConfigPath) and (ReadCfg(OldConfigPath, 'PORT') <> '');
    ModePage.CheckListBox.ItemEnabled[MODE_KEEP] := HasOldConfig;
    if HasOldConfig then ModePage.SelectedValueIndex := MODE_KEEP
    else if (ModePage.SelectedValueIndex <> MODE_DOMAIN) and (ModePage.SelectedValueIndex <> MODE_LAN) then
      ModePage.SelectedValueIndex := MODE_DOMAIN;   { máy mới: chọn sẵn bản tên miền (trước đây không ô nào được chọn) }
  end
  else if CurPageID = PortPage.ID then begin
    if ModePage.SelectedValueIndex = MODE_DOMAIN then begin
      Slug := Lowercase(Trim(DomainPage.Values[0]));
      Ctx := 'D:' + Slug;
      if DomainIsNew then WizardForm.PageDescriptionLabel.Caption := 'Khách mới ' + Slug + '.maychamcongcloud.com — tên miền sẽ trỏ về cổng này'
      else WizardForm.PageDescriptionLabel.Caption := 'Khách ' + Slug + '.maychamcongcloud.com — đang dùng cổng ' + DomainPort;
    end else begin
      Ctx := 'LAN';
      WizardForm.PageDescriptionLabel.Caption := 'Bản LAN — chỉ dùng trong mạng nội bộ';
    end;
    { điền sẵn cổng khi mới vào hoặc vừa đổi kiểu / tên khách; giữ nguyên nếu người cài đã gõ }
    if Ctx <> PortCtx then begin
      PortCtx := Ctx;
      if (ModePage.SelectedValueIndex = MODE_DOMAIN) and not DomainIsNew and (DomainPort <> '') then PortPage.Values[0] := DomainPort
      else if HasOldConfig then PortPage.Values[0] := ReadCfg(OldConfigPath, 'PORT')
      else PortPage.Values[0] := FindFreePort(8686);
    end;
    ShowPortStatus;
  end;
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  if PageID = DomainPage.ID then Result := ModePage.SelectedValueIndex <> MODE_DOMAIN;
  if PageID = PortPage.ID then Result := ModePage.SelectedValueIndex = MODE_KEEP;
  { cài im lặng: lựa chọn lấy từ tham số dòng lệnh (SilentSetup), không chạy các trang hỏi }
  if WizardSilent and ((PageID = DomainPage.ID) or (PageID = PortPage.ID)) then Result := True;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var Cfg, Err, Slug, Pass, P, Why, Alt: String; NotFound: Boolean; Kind: Integer;
begin
  Result := True;
  if WizardSilent then Exit;
  if CurPageID = ModePage.ID then begin
    if ModePage.SelectedValueIndex < 0 then begin
      MsgBox('Chọn một kiểu cài đặt.', mbError, MB_OK); Result := False; Exit;
    end;
    if ModePage.SelectedValueIndex = MODE_KEEP then NewConfig := '';
  end
  else if CurPageID = DomainPage.ID then begin
    Slug := Lowercase(Trim(DomainPage.Values[0]));
    if not ValidSlug(Slug) then begin
      MsgBox('Tên khách chỉ gồm chữ thường, số, gạch ngang (ví dụ: congtyabc).', mbError, MB_OK); Result := False; Exit;
    end;
    if Trim(DomainPage.Values[1]) = '' then begin
      MsgBox('Nhập mật khẩu cấp domain.', mbError, MB_OK); Result := False; Exit;
    end;
    if not ChkDevice.Checked and not ChkPhone.Checked then begin
      MsgBox('Chọn ít nhất một hình thức chấm công (máy hoặc điện thoại).', mbError, MB_OK); Result := False; Exit;
    end;
    Pass := Trim(DomainPage.Values[1]);
    WizardForm.NextButton.Enabled := False;
    try
      { 1) khách đã có → lấy cấu hình cũ (giữ cổng + lựa chọn cũ); trang sau cho đổi cổng nếu bị trùng }
      if FetchConfig(Slug, Pass, FETCH_EXISTING, '', True, True, Cfg, Err, NotFound) then begin
        DomainIsNew := False; DomainCfg := Cfg; DomainPort := CfgVal(Cfg, 'PORT');
      end
      else if NotFound then begin
        { 2) chưa có → hỏi xác nhận (tránh gõ nhầm tên thành tạo tên miền thừa); tạo thật ở trang chọn cổng }
        if MsgBox('Chưa có khách "' + Slug + '".' + #13#10 + #13#10 + 'Tạo MỚI tên miền ' + Slug + '.maychamcongcloud.com cho khách này?' + #13#10 +
                  '(Nếu khách đã có mà hiện thông báo này thì có thể đã gõ sai tên — bấm Không để sửa.)', mbConfirmation, MB_YESNO) = IDYES then begin
          DomainIsNew := True; DomainCfg := ''; DomainPort := '';
        end else Result := False;
      end
      else begin MsgBox(Err, mbError, MB_OK); Result := False; end;
    finally
      WizardForm.NextButton.Enabled := True;
    end;
  end
  else if CurPageID = PortPage.ID then begin
    if not ValidPort(PortPage.Values[0]) then begin
      MsgBox('Cổng phải là số từ 1024 đến 65000.', mbError, MB_OK); Result := False; Exit;
    end;
    P := IntToStr(StrToInt(Trim(PortPage.Values[0])));
    PortPage.Values[0] := P;
    { cổng trùng → báo + gợi ý cổng trống }
    Why := PortProblem(P, ListenPorts);
    if Why <> '' then begin
      Alt := FindFreePort(8686);
      if MsgBox('Cổng ' + P + ' ' + Why + '.' + #13#10 + #13#10 + 'Dùng cổng trống ' + Alt + ' thay thế?' + #13#10 +
                'Yes (Có) = dùng cổng ' + Alt + '.    No (Không) = tự gõ cổng khác.', mbConfirmation, MB_YESNO) = IDYES then begin
        P := Alt; PortPage.Values[0] := P; ShowPortStatus;
      end else begin ShowPortStatus; Result := False; Exit; end;
    end;

    if ModePage.SelectedValueIndex = MODE_LAN then begin NewConfig := LanConfig(P); Exit; end;

    { bản tên miền }
    Slug := Lowercase(Trim(DomainPage.Values[0]));
    Pass := Trim(DomainPage.Values[1]);
    if DomainIsNew then Kind := FETCH_CREATE
    else if P = DomainPort then begin NewConfig := DomainCfg; Exit; end
    else begin
      if MsgBox('Khách "' + Slug + '" đang dùng cổng ' + DomainPort + '. Đổi sang cổng ' + P + '?' + #13#10 + #13#10 +
                'Tên miền ' + Slug + '.maychamcongcloud.com sẽ trỏ về cổng mới. Nếu phần mềm của khách này còn chạy ở máy khác thì máy đó sẽ không vào được bằng tên miền nữa.',
                mbConfirmation, MB_YESNO) <> IDYES then begin Result := False; Exit; end;
      Kind := FETCH_SETPORT;
    end;
    WizardForm.NextButton.Enabled := False;
    try
      if FetchConfig(Slug, Pass, Kind, P, ChkDevice.Checked, ChkPhone.Checked, Cfg, Err, NotFound) then begin
        NewConfig := Cfg;
        { đã tạo / đã đổi trên máy chủ → quay lại trang này thì coi như khách đã có, cổng mới }
        DomainIsNew := False; DomainCfg := Cfg; DomainPort := P;
      end
      else begin MsgBox(Err, mbError, MB_OK); Result := False; end;
    finally
      WizardForm.NextButton.Enabled := True;
    end;
  end;
end;

function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo, MemoTypeInfo, MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
var S: String;
begin
  S := 'Thư mục cài đặt:' + NewLine + Space + WizardDirValue + NewLine + NewLine + 'Kiểu cài đặt:' + NewLine + Space;
  case ModePage.SelectedValueIndex of
    MODE_KEEP: S := S + 'Giữ cấu hình đang có (cổng ' + ReadCfg(OldConfigPath, 'PORT') + ')';
    MODE_DOMAIN: S := S + 'Bản có tên miền: ' + Lowercase(Trim(DomainPage.Values[0])) + '.maychamcongcloud.com, cổng ' + Trim(PortPage.Values[0]);
    MODE_LAN: S := S + 'Bản LAN, cổng ' + Trim(PortPage.Values[0]);
  end;
  Result := S;
end;

{ Cổng cho cài im lặng: /PORT=auto (hoặc bỏ trống khi Def='auto') = cổng trống đầu tiên từ 8686 }
function SilentPort(const Def: String): String;
begin
  Result := Trim(Param('PORT', Def));
  if (Result = '') or (Lowercase(Result) = 'auto') then Result := FindFreePort(8686);
end;

{ Cài im lặng: lấy lựa chọn từ tham số dòng lệnh (không có trang hỏi) }
function SilentSetup(var Err: String): Boolean;
var M, Cfg, P: String; NotFound: Boolean;
begin
  Result := True; Err := '';
  M := Lowercase(Param('MODE', ''));
  if (M = '') or (M = 'keep') then begin
    if FileExists(OldConfigPath) then NewConfig := ''
    else if M = 'keep' then begin Err := 'MODE=keep nhưng chưa có config.txt trong thư mục cài.'; Result := False; end
    else NewConfig := LanConfig(SilentPort('8686'));
  end
  else if M = 'lan' then begin
    P := SilentPort('8686');
    if ValidPort(P) then NewConfig := LanConfig(P)
    else begin Err := 'PORT không hợp lệ.'; Result := False; end;
  end
  else if M = 'domain' then begin
    if FetchConfig(Lowercase(Param('SLUG', '')), Param('PASS', ''), FETCH_EXISTING, '', True, True, Cfg, Err, NotFound) then NewConfig := Cfg
    else if NotFound and (Param('CREATE', '0') = '1') then begin
      P := SilentPort('auto');
      if not ValidPort(P) then begin Err := 'PORT không hợp lệ.'; Result := False; end
      else if FetchConfig(Lowercase(Param('SLUG', '')), Param('PASS', ''), FETCH_CREATE, P, Param('DEVICE', '1') <> '0', Param('PHONE', '1') <> '0', Cfg, Err, NotFound) then NewConfig := Cfg
      else Result := False;
    end else Result := False;
  end
  else begin Err := 'MODE phải là lan, domain hoặc keep.'; Result := False; end;
end;

{ Trước khi chép tệp: dừng bản đang chạy trong thư mục này (nếu có) để chép đè được, rồi ghi config.txt mới }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var Err, OldPort, Dir, Cmd: String; RC: Integer;
begin
  Result := '';
  if WizardSilent then
    if not SilentSetup(Err) then begin Result := Err; Exit; end;

  Dir := AddBackslash(WizardDirValue);
  OldPort := ReadCfg(Dir + 'config.txt', 'PORT');
  if OldPort <> '' then begin
    { chỉ dừng tiến trình đang giữ ĐÚNG cổng cũ + cloudflared của ĐÚNG thư mục này (không đụng khách khác trên cùng máy) }
    Cmd := '-NoProfile -Command "$p=(@(Get-NetTCPConnection -LocalPort ' + OldPort + ' -State Listen -ErrorAction SilentlyContinue))[0].OwningProcess; if($p){ Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }; ' +
           '$cf=''' + Dir + 'cloudflared.exe''; Get-Process cloudflared -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $cf } | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2"';
    Exec('powershell.exe', Cmd, '', SW_HIDE, ewWaitUntilTerminated, RC);
  end;

  if NewConfig <> '' then begin
    if not ForceDirectories(WizardDirValue) then begin Result := 'Không tạo được thư mục ' + WizardDirValue; Exit; end;
    if not SaveStringToFile(Dir + 'config.txt', NewConfig, False) then Result := 'Không ghi được config.txt vào ' + WizardDirValue;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    { Lối tắt ngoài Desktop mở trang quản lý }
    SaveStringToFile(ExpandConstant('{autodesktop}\') + ShortcutName(''),
      '[InternetShortcut]' + #13#10 + 'URL=http://localhost:' + CurrentPort + '/admin' + #13#10 +
      'IconFile=' + ExpandConstant('{app}\digiplus.ico') + #13#10 + 'IconIndex=0' + #13#10, False);
end;
