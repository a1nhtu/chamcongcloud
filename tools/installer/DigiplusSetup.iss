; Trình cài đặt Digiplus Chấm Công (kiểu Next-Next) — biên dịch bằng Inno Setup 6:
;   ISCC /DSrc="<thư mục dist>\DigiplusChamCong" /DAppVer=1.15.66 /DOutDir="<nơi xuất>" tools\installer\DigiplusSetup.iss
; Một file Setup.exe dùng cho MỌI khách:
;   - Bản có tên miền: hỏi tên khách + mật khẩu cấp domain → tự lấy config.txt từ máy chủ; khách CHƯA có thì hỏi xác nhận rồi
;     TẠO MỚI tên miền ngay (cổng tự lấy cổng trống tiếp theo)
;   - Bản LAN: chỉ hỏi cổng, không cần tên khách / mật khẩu
;   - Cài đè lên bản đang có: mặc định GIỮ cấu hình + dữ liệu cũ
; Cài im lặng (thử nghiệm/tự động): /VERYSILENT /MODE=lan|domain|keep /PORT=8686 /SLUG=... /PASS=... /CREATE=1 /DEVICE=1 /PHONE=1 /SKIPAUTO=1 /DIR="..."

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
AppId={{6C6B0B7E-4F0B-4B43-9C2A-D1G1PLU5CC01}
AppName=Digiplus Chấm Công
AppVersion={#AppVer}
AppPublisher=Digiplus
AppPublisherURL=https://digiplus.vn
DefaultDirName={sd}\DigiplusChamCong
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
CloseApplications=no
UninstallDisplayName=Digiplus Chấm Công
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

[Run]
; Đăng ký tự bật khi mở máy + khởi động phần mềm + chờ phần mềm sẵn sàng (CaiDat.bat chế độ im lặng)
Filename: "{app}\CaiDat.bat"; Parameters: "silent{code:AutoParam}"; WorkingDir: "{app}"; Flags: runhidden waituntilterminated; StatusMsg: "Đang khởi động phần mềm (lần đầu có thể mất khoảng 1 phút)..."
Filename: "{code:AdminUrl}"; Description: "Mở trang quản lý Digiplus Chấm Công"; Flags: postinstall shellexec nowait skipifsilent

[UninstallRun]
Filename: "{app}\GoCaiDat.bat"; Parameters: "silent"; WorkingDir: "{app}"; Flags: runhidden waituntilterminated; RunOnceId: "DigiplusStop"

[UninstallDelete]
Type: files; Name: "{autodesktop}\Digiplus Cham Cong.url"

[Code]
const
  MODE_KEEP = 0;
  MODE_DOMAIN = 1;
  MODE_LAN = 2;

var
  ModePage: TInputOptionWizardPage;
  DomainPage: TInputQueryWizardPage;
  ChkDevice, ChkPhone: TNewCheckBox;   { chỉ áp dụng khi TẠO khách mới }
  LanPage: TInputQueryWizardPage;
  NewConfig: String;      { nội dung config.txt sẽ ghi ('' = giữ cấu hình cũ) }
  HasOldConfig: Boolean;

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

{ CreateNew=False: chỉ lấy cấu hình khách đã có (NotFound=True nếu chưa có). CreateNew=True: chưa có thì tạo mới, cổng tự động. }
function FetchConfig(const Slug, Pass: String; CreateNew, UseDevice, UsePhone: Boolean; var Cfg, Err: String; var NotFound: Boolean): Boolean;
var W: Variant; St: Integer; Body: String;
begin
  Result := False; Cfg := ''; Err := ''; NotFound := False;
  Body := '{"pass":"' + JsonEsc(Pass) + '","slug":"' + JsonEsc(Slug) + '","plain":true,';
  if CreateNew then Body := Body + '"autoPort":true,"mode":"office","useDevice":' + BoolJson(UseDevice) + ',"usePhone":' + BoolJson(UsePhone) + '}'
  else Body := Body + '"onlyExisting":true}';
  try
    W := CreateOleObject('WinHttp.WinHttpRequest.5.1');
    W.SetTimeouts(15000, 15000, 30000, 60000);
    W.Open('POST', '{#ApiUrl}', False);
    W.SetRequestHeader('Content-Type', 'application/json');
    W.Send(Body);
    St := W.Status;
    if St = 200 then begin
      Cfg := W.ResponseText;
      if Pos('TUNNEL_TOKEN=', Cfg) > 0 then Result := True
      else Err := 'Máy chủ trả về cấu hình không hợp lệ. Thử lại sau ít phút.';
    end
    else if St = 401 then Err := 'Sai mật khẩu cấp domain.'
    else if St = 404 then begin NotFound := True; Err := 'Chưa có khách "' + Slug + '".'; end
    else if St = 403 then Err := 'Đã hết hạn mức số tên miền được tạo. Liên hệ quản trị Digiplus.'
    else if St = 409 then Err := 'Cổng tự chọn bị trùng. Bấm Tiếp tục lần nữa để thử lại.'
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

  LanPage := CreateInputQueryPage(DomainPage.ID, 'Cổng phần mềm', 'Bản LAN',
    'Phần mềm sẽ mở tại http://localhost:<cổng>/admin. Để nguyên 8686 nếu máy này chỉ cài một bản.');
  LanPage.Add('Cổng (1024–65000):', False);
  LanPage.Values[0] := '8686';
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = ModePage.ID then begin
    HasOldConfig := FileExists(OldConfigPath) and (ReadCfg(OldConfigPath, 'PORT') <> '');
    ModePage.CheckListBox.ItemEnabled[MODE_KEEP] := HasOldConfig;
    if HasOldConfig then ModePage.SelectedValueIndex := MODE_KEEP
    else if ModePage.SelectedValueIndex = MODE_KEEP then ModePage.SelectedValueIndex := MODE_DOMAIN;
  end;
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  if PageID = DomainPage.ID then Result := ModePage.SelectedValueIndex <> MODE_DOMAIN;
  if PageID = LanPage.ID then Result := ModePage.SelectedValueIndex <> MODE_LAN;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var Cfg, Err, Slug, Pass: String; NotFound: Boolean;
begin
  Result := True;
  if CurPageID = ModePage.ID then begin
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
      { 1) khách đã có → lấy cấu hình cũ (giữ cổng + lựa chọn cũ) }
      if FetchConfig(Slug, Pass, False, True, True, Cfg, Err, NotFound) then NewConfig := Cfg
      else if NotFound then begin
        { 2) chưa có → hỏi xác nhận rồi tạo mới (tránh gõ nhầm tên thành tạo tên miền thừa) }
        if MsgBox('Chưa có khách "' + Slug + '".' + #13#10 + #13#10 + 'Tạo MỚI tên miền ' + Slug + '.maychamcongcloud.com cho khách này?' + #13#10 +
                  '(Nếu khách đã có mà hiện thông báo này thì có thể đã gõ sai tên — bấm Không để sửa.)', mbConfirmation, MB_YESNO) = IDYES then begin
          if FetchConfig(Slug, Pass, True, ChkDevice.Checked, ChkPhone.Checked, Cfg, Err, NotFound) then NewConfig := Cfg
          else begin MsgBox(Err, mbError, MB_OK); Result := False; end;
        end else Result := False;
      end
      else begin MsgBox(Err, mbError, MB_OK); Result := False; end;
    finally
      WizardForm.NextButton.Enabled := True;
    end;
  end
  else if CurPageID = LanPage.ID then begin
    if not ValidPort(LanPage.Values[0]) then begin
      MsgBox('Cổng phải là số từ 1024 đến 65000.', mbError, MB_OK); Result := False; Exit;
    end;
    NewConfig := LanConfig(Trim(LanPage.Values[0]));
  end;
end;

function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo, MemoTypeInfo, MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
var S: String;
begin
  S := 'Thư mục cài đặt:' + NewLine + Space + WizardDirValue + NewLine + NewLine + 'Kiểu cài đặt:' + NewLine + Space;
  case ModePage.SelectedValueIndex of
    MODE_KEEP: S := S + 'Giữ cấu hình đang có (cổng ' + ReadCfg(OldConfigPath, 'PORT') + ')';
    MODE_DOMAIN: S := S + 'Bản có tên miền: ' + Lowercase(Trim(DomainPage.Values[0])) + '.maychamcongcloud.com';
    MODE_LAN: S := S + 'Bản LAN, cổng ' + Trim(LanPage.Values[0]);
  end;
  Result := S;
end;

{ Cài im lặng: lấy lựa chọn từ tham số dòng lệnh (không có trang hỏi) }
function SilentSetup(var Err: String): Boolean;
var M, Cfg: String; NotFound: Boolean;
begin
  Result := True; Err := '';
  M := Lowercase(Param('MODE', ''));
  if (M = '') or (M = 'keep') then begin
    if FileExists(OldConfigPath) then NewConfig := ''
    else if M = 'keep' then begin Err := 'MODE=keep nhưng chưa có config.txt trong thư mục cài.'; Result := False; end
    else NewConfig := LanConfig(Param('PORT', '8686'));
  end
  else if M = 'lan' then begin
    if ValidPort(Param('PORT', '8686')) then NewConfig := LanConfig(Param('PORT', '8686'))
    else begin Err := 'PORT không hợp lệ.'; Result := False; end;
  end
  else if M = 'domain' then begin
    if FetchConfig(Lowercase(Param('SLUG', '')), Param('PASS', ''), False, True, True, Cfg, Err, NotFound) then NewConfig := Cfg
    else if NotFound and (Param('CREATE', '0') = '1') then begin
      if FetchConfig(Lowercase(Param('SLUG', '')), Param('PASS', ''), True, Param('DEVICE', '1') <> '0', Param('PHONE', '1') <> '0', Cfg, Err, NotFound) then NewConfig := Cfg else Result := False;
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
    SaveStringToFile(ExpandConstant('{autodesktop}\Digiplus Cham Cong.url'),
      '[InternetShortcut]' + #13#10 + 'URL=http://localhost:' + CurrentPort + '/admin' + #13#10, False);
end;
