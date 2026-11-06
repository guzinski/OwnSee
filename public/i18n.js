// en-US and pt-BR, chosen from the browser's language. Any Portuguese browser
// gets pt-BR; everything else gets en-US. Add new text to both dictionaries.
// Elements in index.html name their text with data-i18n (text content) and
// data-i18n-label (aria-label and title).

const MESSAGES = {
  "en-US": {
    title: "OwnSee",
    home: "Home",
    onHomeNetwork: "You're on your home network.",
    awayEncrypted: "You're away. Video is encrypted.",
    noCameras: "No cameras yet. Add them in data/sources.json.",
    cantReachHub: "Can't reach the hub. Check that it's running, then reload.",
    phones: "Phones",
    selectedCamera: "Selected camera",
    live: "Live",
    backToLive: "Back to live",
    pause: "Pause",
    play: "Play",
    savePhoto: "Save photo",
    downloadClip: "Download these 5 minutes",
    position: "Position in the recording",
    fullScreen: "Full screen",
    openCamera: "Open {name}",
    recordings: "Recordings",
    day: "Day",
    pickHour: "Pick an hour",
    today: "Today",
    yesterday: "Yesterday",
    dayAtTime: "{day}, {time}",
    withinHour: "Within {from} to {to}",
    playFrom: "Play from {time}",
    noRecordingAt: "{time}, no recording",
    loadingRecordings: "Loading recordings…",
    noRecordings: "No recordings on this day",
    recordingsFailed: "Couldn't load recordings. Pick the day again to retry.",
    loadingRecording: "Loading recording…",
    cantPlay: "Can't play: {reason}",
    cantPlayHub: "Can't play: hub returned {status}",
    playAborted: "aborted",
    playNetwork: "network error",
    playDecode: "decode error",
    playFormat: "format not supported",
    playUnknown: "unknown error",
    noH265: "This browser can't play H.265 recordings (try the Android app/browser)",
    noCodec: "This browser can't play {codec}",
    pressPlay: "Press play to start",
    playbackStopped: "Playback stopped: {reason}",
    cancel: "Cancel",
    dlWaiting: "{label}: waiting for the NVR…",
    dlProgress: "{label}: {percent}%, {got} of about {total}",
    dlBytes: "{label}: {got}",
    dlSaved: "Saved {name}",
    dlCancelled: "Download cancelled: {label}",
    dlFailed: "Download failed: {reason}",
    errHubStatus: "hub answered {status}",
    errNoVideo: "no video received",
    close: "Close",
    getApp: "Get the app",
    checking: "Checking…",
    pairedPhones: "Paired phones",
    pairedIntro: "Phones paired here can watch remotely through the hub's HTTPS address. Pairing only works on this home network.",
    pairPhone: "Pair a phone",
    pairInstructionBefore: "In the OwnSee app, tap ",
    pairInstructionButton: "Scan pairing code",
    pairInstructionAfter: " and point it at this code.",
    loadPhonesFailed: "Couldn't load phones.",
    noPhones: "No phones paired yet.",
    pairedOn: "{name}, paired {date}",
    revokedSuffix: ", revoked",
    revoke: "Revoke",
    revokeConfirm: "Revoke \"{name}\"? It loses access immediately and must be paired again.",
    creatingCode: "Creating pairing code…",
    errorStatus: "Error {status}",
    useLanAddress: "Open this page using the hub's home network address, not localhost, or set HUB_LAN_URL in .env.local.",
    remoteNote: "Away from home it will use {address}.",
    noRemoteNote: "No remote address set (HUB_PUBLIC_URL), so it will only work at home.",
    codeExpiresIn: "Single use, expires in {time}. {note}",
    codeExpired: "Code expired. Click \"Pair a phone\" for a new one.",
    checkAppFailed: "Couldn't check for the app.",
    noAppPublished: "No app published on this hub yet (run scripts/publish-apk.sh).",
    appInfoBefore: "OwnSee {version} ({size}). Scan with the phone's camera on this Wi-Fi, or ",
    appInfoLink: "download it",
    appInfoAfter: ". Android asks once to allow installs from your browser.",
    loginTitle: "Enter the hub password",
    password: "Password",
    logIn: "Log in",
    logOut: "Log out",
    wrongPassword: "Wrong password.",
    tooManyTries: "Too many tries. Wait {seconds} seconds.",
    noPassword: "No password is set yet. On the hub computer, run: bash scripts/set-password.sh",
  },
  "pt-BR": {
    title: "OwnSee",
    home: "Início",
    onHomeNetwork: "Você está na rede de casa.",
    awayEncrypted: "Você está fora de casa. O vídeo é criptografado.",
    noCameras: "Nenhuma câmera ainda. Adicione em data/sources.json.",
    cantReachHub: "Não foi possível acessar o hub. Verifique se ele está ligado e recarregue a página.",
    phones: "Celulares",
    selectedCamera: "Câmera selecionada",
    live: "Ao vivo",
    backToLive: "Voltar ao vivo",
    pause: "Pausar",
    play: "Reproduzir",
    savePhoto: "Salvar foto",
    downloadClip: "Baixar estes 5 minutos",
    position: "Posição na gravação",
    fullScreen: "Tela cheia",
    openCamera: "Abrir {name}",
    recordings: "Gravações",
    day: "Dia",
    pickHour: "Escolha um horário",
    today: "Hoje",
    yesterday: "Ontem",
    dayAtTime: "{day}, {time}",
    withinHour: "Das {from} às {to}",
    playFrom: "Reproduzir a partir das {time}",
    noRecordingAt: "{time}, sem gravação",
    loadingRecordings: "Carregando gravações…",
    noRecordings: "Nenhuma gravação neste dia",
    recordingsFailed: "Não foi possível carregar as gravações. Escolha o dia de novo para tentar outra vez.",
    loadingRecording: "Carregando gravação…",
    cantPlay: "Não foi possível reproduzir: {reason}",
    cantPlayHub: "Não foi possível reproduzir: o hub respondeu {status}",
    playAborted: "cancelado",
    playNetwork: "erro de rede",
    playDecode: "erro de decodificação",
    playFormat: "formato não suportado",
    playUnknown: "erro desconhecido",
    noH265: "Este navegador não reproduz gravações H.265 (tente o app ou o navegador do Android)",
    noCodec: "Este navegador não reproduz {codec}",
    pressPlay: "Toque em reproduzir para começar",
    playbackStopped: "A reprodução parou: {reason}",
    cancel: "Cancelar",
    dlWaiting: "{label}: aguardando o NVR…",
    dlProgress: "{label}: {percent}%, {got} de cerca de {total}",
    dlBytes: "{label}: {got}",
    dlSaved: "{name} salvo",
    dlCancelled: "Download cancelado: {label}",
    dlFailed: "Falha no download: {reason}",
    errHubStatus: "o hub respondeu {status}",
    errNoVideo: "nenhum vídeo recebido",
    close: "Fechar",
    getApp: "Baixe o app",
    checking: "Verificando…",
    pairedPhones: "Celulares pareados",
    pairedIntro: "Os celulares pareados aqui podem assistir de longe pelo endereço HTTPS do hub. O pareamento só funciona nesta rede de casa.",
    pairPhone: "Parear um celular",
    pairInstructionBefore: "No app OwnSee, toque em ",
    pairInstructionButton: "Escanear código de pareamento",
    pairInstructionAfter: " e aponte para este código.",
    loadPhonesFailed: "Não foi possível carregar os celulares.",
    noPhones: "Nenhum celular pareado ainda.",
    pairedOn: "{name}, pareado em {date}",
    revokedSuffix: ", revogado",
    revoke: "Revogar",
    revokeConfirm: "Revogar \"{name}\"? Ele perde o acesso na hora e precisará ser pareado de novo.",
    creatingCode: "Criando o código de pareamento…",
    errorStatus: "Erro {status}",
    useLanAddress: "Abra esta página pelo endereço do hub na rede de casa, não por localhost, ou defina HUB_LAN_URL no .env.local.",
    remoteNote: "Fora de casa, ele usará {address}.",
    noRemoteNote: "Nenhum endereço remoto definido (HUB_PUBLIC_URL), então só funcionará em casa.",
    codeExpiresIn: "Uso único, expira em {time}. {note}",
    codeExpired: "O código expirou. Clique em \"Parear um celular\" para gerar outro.",
    checkAppFailed: "Não foi possível verificar o app.",
    noAppPublished: "Nenhum app publicado neste hub ainda (execute scripts/publish-apk.sh).",
    appInfoBefore: "OwnSee {version} ({size}). Escaneie com a câmera do celular neste Wi-Fi, ou ",
    appInfoLink: "baixe aqui",
    appInfoAfter: ". O Android pede uma vez para permitir instalações pelo navegador.",
    loginTitle: "Digite a senha do hub",
    password: "Senha",
    logIn: "Entrar",
    logOut: "Sair",
    wrongPassword: "Senha incorreta.",
    tooManyTries: "Muitas tentativas. Aguarde {seconds} segundos.",
    noPassword: "Nenhuma senha definida ainda. No computador do hub, execute: bash scripts/set-password.sh",
  },
};

const wanted = navigator.languages?.length ? navigator.languages : [navigator.language];
const match = wanted.find((l) => /^(pt|en)\b/i.test(l)) ?? "en";

/** The language the page is showing. Dates use this, so they match the text. */
export const lang = /^pt/i.test(match) ? "pt-BR" : "en-US";

/** Translated text; {name} placeholders are filled from vars. */
export function t(key, vars = {}) {
  return MESSAGES[lang][key].replace(/\{(\w+)\}/g, (_, name) => vars[name]);
}

/** Fri, or Sex in pt-BR (which Intl writes "sex."). */
export function shortDay(date) {
  const name = new Intl.DateTimeFormat(lang, { weekday: "short" }).format(date).replace(".", "");
  return name[0].toLocaleUpperCase(lang) + name.slice(1);
}

/** Friday, November 6, or sexta-feira, 6 de novembro. */
export const longDay = (date) =>
  new Intl.DateTimeFormat(lang, { weekday: "long", day: "numeric", month: "long" }).format(date);

/** 11/6/2026, or 06/11/2026 in pt-BR. */
export const numericDate = (date) =>
  new Intl.DateTimeFormat(lang, { day: "numeric", month: "numeric", year: "numeric" }).format(date);

document.documentElement.lang = lang;
document.title = t("title");
for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
for (const el of document.querySelectorAll("[data-i18n-label]")) {
  const text = t(el.dataset.i18nLabel);
  el.setAttribute("aria-label", text);
  if (el.hasAttribute("title")) el.title = text;
}
