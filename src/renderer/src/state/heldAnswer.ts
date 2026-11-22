/**
 * How the user answered "send it?" while asking first is on, the phone's
 * VoiceThreadRouting.heldRequestAnswer and saysSendToHermes (hermes-conduit
 * #451, #1223): a held request goes to Hermes only on the user's own yes, read
 * from their words the same way in every live mode, whatever the model made of
 * them. The word lists are the phone's, in its shipped languages; keep them in
 * step with Conduit/Voice/VoiceBackgroundJobs.swift.
 */

export type HeldAnswer =
  /** Yes, led by a yes word or a send; `addition` is the answer when it says more. */
  | { kind: 'yes'; addition: string | null }
  /** Neither yes nor no: a change, unless the model took it as a yes. */
  | { kind: 'other'; words: string }
  /** No: dropped. With more words, `change` is the answer. */
  | { kind: 'no'; change: string | null }
  /** Not yet: it keeps waiting. With more words, `change` is the answer. */
  | { kind: 'notYet'; change: string | null }

const fillers = new Set(["uh", "uhh", "um", "umm", "uhm", "er", "erm", "ah", "hmm"])
const sendVetoes = new Set(["don't", "dont", "not", "never", "no", "stop", "without", "before", "won't", "can't", "cannot", "shouldn't", "didn't", "did", "when", "whether", "if", "what", "why", "how", "where", "who", "should", "shall", "has", "have", "was", "were", "remind", "rather", "than", "instead"])
const answerNoLeads = ["no way", "no chance", "not a chance", "no", "nope", "nah", "don't", "dont", "do not", "never mind", "nevermind", "cancel", "forget", "drop", "scrap", "skip", "ditch", "abort", "stop", "leave it", "leave that", "nein", "nee", "nö", "auf keinen fall", "lieber nicht", "bloß nicht", "nicht nötig", "nicht senden", "nicht schicken", "nicht abschicken", "vergiss es", "vergiss das", "vergiss", "lass es", "lass das", "lass mal", "abbrechen", "brich ab", "stopp", "stornieren", "storniere", "nop", "mejor no", "cancela", "cancélalo", "cancelalo", "cancelar", "anúlalo", "anulalo", "anular", "anula", "olvídalo", "olvidalo", "olvida", "déjalo", "dejalo", "ni hablar", "non", "pas besoin", "pas la peine", "surtout pas", "laisse tomber", "laissez tomber", "oublie", "oubliez", "annule", "annulez", "annuler", "arrête", "arrete", "ne l'envoie pas", "ne l'envoyez pas", "ne pas l'envoyer", "ne pas envoyer", "n'envoie pas", "n'envoyez pas", "ne le fais pas", "ne fais pas", "não", "nao", "negativo", "melhor não", "melhor nao", "esquece", "esqueça", "esqueca", "deixa pra lá", "deixa pra la", "cancele", "нет", "неа", "не надо", "не нужно", "не стоит", "не отправляй", "не отправляйте", "отмена", "отмени", "отмените", "забудь", "забудьте", "забей", "стоп", "annulla", "lascia perdere", "lascia stare", "dimenticalo", "dimentica", "meglio di no", "nie wysyłaj", "nie", "lepiej nie", "w żadnym wypadku", "anuluj", "zapomnij", "daj spokój", "nieważne", "hayır", "yok", "iptal et", "iptal", "boş ver", "vazgeç", "gerek yok", "gönderme", "göndermeyin", "istemiyorum", "istemem", "unut gitsin", "unut", "tidak usah", "tidak perlu", "tidak jadi", "tidak", "tak usah", "tak perlu", "tak jadi", "tak bisa", "tak mau", "tak akan", "tak ada", "tak boleh", "tak payah", "nggak usah", "nggak perlu", "nggak jadi", "nggak", "enggak", "gak usah", "gak perlu", "gak jadi", "gak", "ga usah", "ga jadi", "ga", "jangan dikirim", "jangan", "batalkan", "batal", "lupakan", "아니요", "아니오", "아뇨", "아니", "됐어요", "됐어", "취소해 주세요", "취소해", "취소", "보내지 마세요", "보내지 마", "하지 마세요", "하지 마", "필요 없어요", "필요없어요", "안 돼요", "안 돼", "안돼요", "안돼", "싫어요", "싫어", "그만해요", "그만해", "못 해요", "못 해", "못해요", "못해", "그만"]
const answerNotYetLeads = ["wait", "hold on", "hang on", "not yet", "not now", "one sec", "one second", "one moment", "just a sec", "just a second", "just a moment", "hold it", "warte", "wart", "warten sie", "warten", "abwarten", "moment", "einen moment", "einen augenblick", "augenblick", "eine sekunde", "sekunde", "noch nicht", "jetzt nicht", "nicht jetzt", "espera", "espere", "esperá", "un momento", "un momentito", "un segundo", "un minuto", "un minutito", "momento", "todavía no", "todavia no", "aún no", "aun no", "ahora no", "por ahora no", "no todavía", "no todavia", "no ahora", "no por ahora", "attends", "attendez", "un instant", "une seconde", "une minute", "un moment", "pas encore", "pas maintenant", "pas tout de suite", "segundo", "minuto", "minutinho", "peraí", "perai", "pera", "aguarda", "aguarde", "ainda não", "ainda nao", "agora não", "agora nao", "não agora", "nao agora", "não ainda", "nao ainda", "подожди", "подождите", "погоди", "погодите", "секунду", "секундочку", "минуту", "минутку", "пока нет", "пока не надо", "не сейчас", "ещё нет", "еще нет", "ещё не", "еще не", "aspetta", "aspetti", "un attimo", "un secondo", "non ancora", "non adesso", "non ora", "adesso no", "ora no", "ancora no", "czekaj", "poczekaj", "zaczekaj", "chwileczkę", "chwilkę", "chwilę", "chwila", "sekundę", "minutę", "momencik", "jeszcze nie", "nie teraz", "bir dakika", "bir saniye", "biraz bekle", "bekle", "bekleyin", "dur", "henüz değil", "şimdi değil", "daha değil", "tunggu sebentar", "tunggu dulu", "tunggu", "sebentar", "semenit", "sedetik", "belum", "jangan sekarang", "nanti dulu", "nanti saja", "nanti aja", "tidak sekarang", "nggak sekarang", "gak sekarang", "tak sekarang", "잠깐만요", "잠깐만", "잠깐", "잠시만요", "잠시만", "아직 아니요", "아직이요", "아직", "지금은 아니요", "지금 말고", "기다려 주세요", "기다려요", "기다려"]
const answerYesLeads = ["no problem", "no worries", "no rush", "yes", "yeah", "yep", "yup", "yea", "ya", "sure", "ok", "okay", "alright", "all right", "go ahead", "go for it", "do it", "send it", "send that", "send this", "please", "correct", "right", "exactly", "absolutely", "definitely", "of course", "sounds good", "perfect", "great", "fine", "good", "that's right", "that's it", "that works", "works for me", "that'll do", "sounds great", "that's great", "go", "uh huh", "mhm", "why not", "ja", "jawohl", "genau", "na klar", "alles klar", "klar", "sicher", "gerne", "gern", "einverstanden", "in ordnung", "kein problem", "sehr gerne", "bitte", "selbstverständlich", "natürlich", "auf jeden fall", "mach das", "mach es", "mach's", "machs", "schick es ab", "schick es", "schick's ab", "schick's", "schicks", "schick ab", "abschicken", "absenden", "sehr gut", "gut", "super", "prima", "perfekt", "no hay problema", "no te preocupes", "no pasa nada", "no hay prisa", "sí", "claro que sí", "claro que si", "claro que sim", "claro", "vale", "de acuerdo", "por supuesto", "adelante", "venga", "perfecto", "sin problema", "por favor", "hazlo", "envíalo", "envialo", "mándalo", "mandalo", "envíaselo", "mándaselo", "me parece bien", "está bien", "esta bien", "muy bien", "genial", "listo", "exacto", "correcto", "eso es", "oui", "ouais", "d'accord", "bien sûr", "bien sur", "volontiers", "parfait", "allez y", "vas y", "pas de problème", "pas de probleme", "pas de souci", "pas de soucis", "aucun problème", "aucun probleme", "aucun souci", "envoie le", "envoie la", "envoie ça", "envoie ca", "envoyez le", "envoyez la", "s'il te plaît", "s'il te plait", "s'il vous plaît", "s'il vous plait", "c'est parfait", "ça marche", "ca marche", "ça me va", "ca me va", "très bien", "tres bien", "entendu", "exactement", "évidemment", "evidemment", "carrément", "carrement", "sim", "com certeza", "certo", "beleza", "tá bom", "ta bom", "está bem", "esta bem", "tudo bem", "tudo certo", "pode ser", "pode sim", "pode mandar", "pode enviar", "manda ver", "sem problema", "sem problemas", "não tem problema", "nao tem problema", "não se preocupe", "nao se preocupe", "fechado", "perfeito", "ótimo", "otimo", "isso mesmo", "isso aí", "isso ai", "exato", "не вопрос", "да", "ага", "угу", "конечно", "давай", "давайте", "хорошо", "ладно", "ок", "окей", "отлично", "супер", "без проблем", "нет проблем", "согласен", "согласна", "верно", "точно", "правильно", "именно", "пожалуйста", "отправляй", "отправляйте", "вперёд", "вперед", "годится", "пойдёт", "пойдет", "sì", "certamente", "va bene", "d'accordo", "perfetto", "esatto", "giusto", "volentieri", "vai pure", "vai avanti", "vai", "procedi", "invialo", "fallo", "assolutamente", "ovviamente", "sicuro", "benissimo", "ottimo", "nessun problema", "come no", "per favore", "nie ma problemu", "nie ma sprawy", "no jasne", "no pewnie", "no dobra", "no dobrze", "no tak", "tak masalah", "tak", "jasne", "pewnie", "na pewno", "oczywiście", "dobrze", "dobra", "okej", "zgoda", "wyślij to", "wysyłaj", "śmiało", "proszę", "świetnie", "idealnie", "zgadza się", "w porządku", "racja", "dokładnie", "bez problemu", "evet", "tamam", "olur", "tabii ki", "tabii", "elbette", "kesinlikle", "peki", "gönder", "yolla", "hadi", "olsun", "harika", "mükemmel", "doğru", "aynen", "sorun yok", "problem yok", "lütfen", "tidak apa apa", "tidak masalah", "nggak apa apa", "nggak masalah", "gak apa apa", "gak masalah", "ga apa apa", "ga masalah", "iya", "oke", "baiklah", "baik", "boleh", "tentu saja", "tentu", "pasti", "silakan", "kirim saja", "kirim aja", "kirimkan", "lanjutkan", "lanjut", "setuju", "benar", "betul", "bagus", "sip", "mantap", "tolong", "네", "예", "응", "좋아요", "좋아", "그래요", "그래", "그럼요", "물론이죠", "물론", "보내 주세요", "보내주세요", "보내줘", "부탁해요", "부탁합니다", "알겠어요", "알겠습니다", "오케이"]
const answerRefusalTails = ["i'm good", "i'm fine", "i'm ok", "i'm okay", "we're good", "all good", "all set", "as is", "it's fine", "it's ok", "it's okay", "that's fine", "that's ok", "that's okay", "no problem", "no worries", "no rush", "schon gut", "passt schon", "passt so", "alles gut", "ist gut", "ist okay", "así está bien", "asi esta bien", "está bien así", "esta bien asi", "estoy bien", "lo mandes", "lo envíes", "lo envies", "lo hagas", "hace falta", "es necesario", "no hay problema", "no te preocupes", "no pasa nada", "no hay prisa", "sin problema", "ça va", "ca va", "c'est bon", "ça ira", "ca ira", "comme ça", "comme ca", "aucun problème", "aucun probleme", "aucun souci", "precisa não", "precisa nao", "precisa", "tô bem", "to bem", "estou bem", "tá bom", "ta bom", "está bom", "esta bom", "tudo bem", "assim mesmo", "sem problema", "sem problemas", "всё нормально", "все нормально", "всё хорошо", "все хорошо", "нормально", "так нормально", "без проблем", "serve", "c'è bisogno", "importa", "fa niente", "va bene così", "va bene", "sto bene", "tutto a posto", "a posto", "nessun problema", "trzeba", "ma potrzeby", "w porządku", "wszystko dobrze", "jest dobrze", "bez problemu", "kalsın", "böyle iyi", "iyiyim", "tidak apa apa", "nggak apa apa", "gak apa apa", "ga apa apa", "sudah cukup", "udah cukup", "cukup", "tak masalah", "괜찮아요", "괜찮습니다"]
const answerJoiners = ["but", "actually", "oh", "well", "aber", "doch", "naja", "äh", "ähm", "pero", "bueno", "eh", "mais", "bon", "euh", "mas", "então", "entao", "só", "но", "ну", "э", "эм", "ma", "beh", "allora", "ehm", "ale", "właściwie", "cóż", "ama", "aslında", "şey", "yani", "tapi", "sebenarnya", "근데", "그런데", "하지만", "음"]
const answerTurnWords = new Set(["not", "never", "no", "dont", "without", "cannot", "whether", "if", "unless", "what", "why", "how", "where", "who", "should", "shall", "wait", "hold", "think", "later", "maybe", "nope", "nah", "cancel", "stop", "forget", "drop", "scrap", "skip", "ditch", "abort", "nicht", "kein", "keine", "keinen", "keiner", "nichts", "nie", "niemals", "ohne", "ob", "falls", "warum", "wieso", "weshalb", "wann", "wo", "wer", "vielleicht", "später", "warte", "abbrechen", "vergiss", "überlegen", "nachdenken", "nunca", "sin", "quizás", "quizas", "quizá", "quiza", "luego", "después", "despues", "tarde", "espera", "cancela", "cancelar", "olvida", "olvídalo", "olvidalo", "qué", "cómo", "cuándo", "dónde", "quién", "pensar", "pensarlo", "pas", "jamais", "rien", "sans", "peut", "tard", "attends", "attendez", "annule", "annuler", "oublie", "pourquoi", "comment", "quand", "où", "quoi", "réfléchir", "reflechir", "não", "nao", "sem", "talvez", "depois", "esquece", "cancele", "quê", "onde", "не", "нет", "ни", "никогда", "ничего", "без", "если", "ли", "почему", "зачем", "где", "кто", "может", "потом", "позже", "подожди", "погоди", "отмена", "отмени", "забудь", "подумать", "non", "mai", "niente", "nulla", "senza", "se", "forse", "dopo", "perché", "dove", "chi", "aspetta", "annulla", "pensarci", "nigdy", "nic", "jeśli", "czy", "może", "później", "potem", "dlaczego", "czemu", "gdzie", "kto", "czekaj", "anuluj", "zapomnij", "pomyśleć", "zastanowić", "değil", "hiç", "asla", "olmadan", "eğer", "belki", "sonra", "neden", "niye", "nasıl", "nerede", "bekle", "iptal", "düşüneyim", "tidak", "nggak", "gak", "jangan", "belum", "tanpa", "kalau", "jika", "apakah", "mungkin", "nanti", "kenapa", "mengapa", "bagaimana", "mana", "siapa", "tunggu", "batal", "pikir", "pikirkan", "안", "못", "말고", "없이", "만약", "왜", "어떻게", "어디", "누가", "나중에", "아마", "잠깐", "생각해"])
const answerFillerWords = new Set(["thanks", "thank", "you", "please", "yet", "now", "anymore", "it", "that", "this", "send", "sending", "to", "hermes", "do", "don't", "dont", "not", "no", "yes", "just", "right", "a", "the", "moment", "second", "sec", "one", "wait", "hold", "on", "i", "said", "go", "ahead", "and", "ok", "okay", "sure", "that's", "all", "about", "minute", "ja", "danke", "bitte", "schön", "sehr", "es", "das", "an", "jetzt", "noch", "mal", "eine", "einen", "sekunde", "augenblick", "kurz", "sí", "que", "gracias", "por", "favor", "lo", "eso", "ahora", "todavía", "todavia", "un", "momento", "segundo", "poco", "poquito", "enviar", "mandar", "envíes", "envies", "mandes", "oui", "merci", "beaucoup", "s'il", "te", "vous", "plaît", "plait", "le", "la", "ça", "ca", "à", "maintenant", "encore", "une", "seconde", "instant", "peu", "envoie", "envoyer", "envoyez", "tout", "sim", "obrigado", "obrigada", "valeu", "isso", "agora", "ainda", "para", "pro", "ao", "o", "um", "pouco", "pouquinho", "aí", "mande", "envie", "manda", "envia", "да", "спасибо", "пожалуйста", "это", "его", "сейчас", "ещё", "еще", "гермес", "гермесу", "немного", "отправлять", "отправляй", "отправь", "отправить", "grazie", "mille", "per", "pure", "adesso", "ora", "ancora", "attimo", "sì", "inviare", "inviarlo", "inviarla", "mandare", "mandarlo", "mandarla", "tak", "dzięki", "dziękuję", "proszę", "teraz", "jeszcze", "wysyłaj", "wysyłać", "wysłać", "tego", "evet", "teşekkürler", "teşekkür", "ederim", "sağ", "ol", "lütfen", "şimdi", "bunu", "onu", "ya", "terima", "kasih", "makasih", "saja", "aja", "dong", "deh", "sekarang", "itu", "ini", "ke", "dulu", "kirim", "dikirim", "mau", "bisa", "네", "감사합니다", "고마워요", "고마워", "주세요", "부탁해요", "지금", "그거", "이거"])
const answerNegations = new Set(["not", "never", "dont", "nothing", "nicht", "kein", "keine", "keinen", "nichts", "nie", "niemals", "nunca", "nada", "ni", "pas", "rien", "jamais", "não", "nao", "не", "нет", "ничего", "никогда", "non", "mai", "niente", "nulla", "nigdy", "nic", "değil", "yok", "hiç", "asla", "tidak", "nggak", "enggak", "gak", "ga", "jangan", "belum", "bukan", "안", "못"])
const answerBareSendLeads = new Set(["abschicken", "absenden", "pode mandar", "pode enviar", "отправляй", "отправляйте", "wysyłaj", "gönder", "yolla", "kirimkan"])
const cjkAnswerNoLeads = ["いいえ", "いえ", "ううん", "いや", "やめて", "結構です", "けっこうです", "要らない", "いらない", "キャンセル", "不要", "不用", "不了", "不是", "不对", "不行", "不需要", "算了", "取消", "别发"]
const cjkAnswerNotYetLeads = ["ちょっと待って", "待って", "まだ", "ちょっと", "等等", "等一下", "稍等", "先等", "先别", "先不", "还没", "暂时不"]
const cjkAnswerYesLeads = ["はい", "うん", "ええ", "お願いします", "オッケー", "オーケー", "どうぞ", "送って", "送信して", "そうして", "好的", "好啊", "好呀", "好吧", "行吧", "行啊", "是的", "对的", "当然", "没有问题", "沒有問題", "没问题", "沒問題", "发吧", "发送吧"]
const cjkAnswerClauseYes = new Set(["好", "对", "嗯", "行", "是", "可以", "お願い"])
const cjkAnswerClauseNo = new Set(["不", "别"])
const cjkAnswerFillers = ["ありがとうございます", "ありがとう", "お願いします", "お願い", "ください", "どうも", "です", "ます", "ね", "よ", "送って", "没有问题", "沒有問題", "没问题", "沒問題", "谢谢", "谢了", "发吧", "发送", "请", "吧", "了", "啊", "呀", "呢", "的"]
const cjkAnswerTurns = ["不", "没", "别", "但", "等", "想", "考虑", "でも", "けど", "やめ", "待", "ない", "ません", "考え"]

const fold = (text: string) => text.toLowerCase().replace(/’/g, "'").replace(/i̇/g, 'i')
const wordsOf = (text: string) =>
  fold(text)
    .split(/[^\p{L}\p{M}\p{N}']+/u)
    .filter(word => word && !fillers.has(word))
const split = (lead: string) => lead.split(' ')
const startsWith = (words: string[], lead: string[]) => lead.length <= words.length && lead.every((word, i) => words[i] === word)

const ANSWER_YES_ALSO_NOT = 'tak'
const answerNoLeadWords = answerNoLeads.map(split)
/** Positive leads a no lead starts ("no problem", "no todavía"): a yes or a not yet, not a no. */
const answerLeadsStartingWithNo = [...answerYesLeads, ...answerNotYetLeads]
  .map(split)
  .filter(lead => lead.length > 1 && answerNoLeadWords.some(no => startsWith(lead, no)))
const negates = (words: string[]) => words.some(word => answerNegations.has(word) || word.endsWith("n't"))

const SEND_PHRASE = String.raw`\bsend\s*(it|this|that|this one|that one)?\s*(straight|right|over|directly)?`
const SEND_TO_HERMES = new RegExp(SEND_PHRASE + String.raw`\s*to\s*hermes\b`, 'g')
const SEND_HERMES_AT_END = new RegExp(SEND_PHRASE + String.raw`[\s,]*hermes\s*(now|please)?[\s.!]*$`, 'g')

/**
 * "Send it to Hermes": the user already said where it goes, so asking first
 * doesn't ask. Never when the words before it in its clause say not to or
 * only ask about it. Without the "to", only when nothing follows and the words
 * are `finished`.
 */
export function saysSendToHermes(words: string, finished = true): boolean {
  const folded = fold(words)
  for (const pattern of finished ? [SEND_TO_HERMES, SEND_HERMES_AT_END] : [SEND_TO_HERMES]) {
    pattern.lastIndex = 0
    for (const match of folded.matchAll(pattern)) {
      const clause = folded.slice(0, match.index).split(/[,.;:!?]/).at(-1) ?? ''
      if (!clause.split(/\s+/).some(word => sendVetoes.has(word))) return true
    }
  }
  return false
}

export function heldRequestAnswer(answer: string): HeldAnswer {
  const spoken = answer.trim()
  const cjk = cjkHeldRequestAnswer(spoken)
  if (cjk) return cjk
  let words = wordsOf(spoken)
  const saysNot = new RegExp(String.raw`(^|[^\p{L}\p{N}'])${ANSWER_YES_ALSO_NOT}\s+[\p{L}\p{N}]`, 'u').test(fold(spoken))
  const yesLeads = saysNot ? answerYesLeads.filter(lead => lead !== ANSWER_YES_ALSO_NOT) : answerYesLeads
  const more = (rest: string[]) => (rest.some(word => !answerFillerWords.has(word)) ? spoken : null)
  const dropLead = (leads: string[]) => {
    for (const lead of leads) {
      const leadWords = split(lead)
      if (startsWith(words, leadWords)) {
        words = words.slice(leadWords.length)
        return true
      }
    }
    return false
  }
  const startsWithNoLead = () => !answerLeadsStartingWithNo.some(lead => startsWith(words, lead)) && answerNoLeadWords.some(lead => startsWith(words, lead))
  const dropNoLead = () => startsWithNoLead() && dropLead(answerNoLeads)
  const change = (rest: string[]) => (negates(rest) ? null : more(rest))
  const dropFiller = () => {
    if (!words.length || !answerFillerWords.has(words[0]!)) return false
    words = words.slice(1)
    return true
  }
  const refusal = (): HeldAnswer => {
    const rest = words
    while (dropNoLead() || dropLead(answerNotYetLeads) || dropLead(answerRefusalTails) || dropFiller()) {
      // Another no, a not yet or a polite tail is still the no.
    }
    return { kind: 'no', change: negates(rest) ? null : more(words) }
  }
  const notYet = (): HeldAnswer => {
    while (dropLead(answerJoiners) || dropLead(answerNotYetLeads)) {
      // More wait words are still the wait.
    }
    if (dropNoLead()) return refusal()
    return { kind: 'notYet', change: change(words) }
  }
  while (dropLead(answerJoiners)) {
    // "Oh yes", "Well, no".
  }
  if (dropNoLead()) return refusal()
  if (dropLead(answerNotYetLeads)) return notYet()
  const unanswered = words
  if (!dropLead(yesLeads)) {
    // "Send to Hermes", or just "Send": a yes with nothing more.
    if ((words.length === 1 && words[0] === 'send') || saysSendToHermes(spoken)) return { kind: 'yes', addition: more(words) }
    return { kind: 'other', words: spoken }
  }
  const lead = unanswered.slice(0, unanswered.length - words.length).join(' ')
  if (answerBareSendLeads.has(lead) && more(words) !== null && !saysSendToHermes(spoken)) return { kind: 'other', words: spoken }
  while (!startsWithNoLead() && (dropLead(yesLeads) || dropLead(answerJoiners))) {
    // "Okay, wait", "Yeah, but actually no": what follows decides.
  }
  if (dropNoLead()) return refusal()
  if (dropLead(answerNotYetLeads)) return notYet()
  const turned = words.some(
    word =>
      answerTurnWords.has(word) || word.endsWith("n't") || (saysNot && word === ANSWER_YES_ALSO_NOT) || answerTurnWords.has(word.split("'")[0]!)
  )
  if (words.length && (turned || spoken.includes('?'))) return { kind: 'other', words: spoken }
  // "Yes, send it to Hermes": the send is the yes.
  const rest = saysSendToHermes(words.join(' ')) ? [] : words
  return { kind: 'yes', addition: more(rest) }
}

/** Japanese and Chinese have no word breaks: an answer is read from how it starts. */
function cjkHeldRequestAnswer(spoken: string): HeldAnswer | null {
  const clauses = spoken.split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean)
  const all = clauses.join('')
  let rest = all
  const dropLead = (leads: string[]) => {
    const lead = leads.find(each => rest.startsWith(each))
    if (lead === undefined) return false
    rest = rest.slice(lead.length)
    return true
  }
  const dropClause = (answers: Set<string>) => {
    const first = clauses[0]
    if (rest !== all || !first) return false
    const character = Array.from(first)[0]!
    const repeated = answers.has(character) && Array.from(first).every(each => each === character)
    if (!answers.has(first) && !repeated) return false
    rest = rest.slice(first.length)
    return true
  }
  const left = () => cjkAnswerFillersByLength.reduce((text, filler) => text.split(filler).join(''), rest)
  const turned = (words: string) => cjkAnswerTurns.some(turn => words.includes(turn))
  const change = () => {
    const words = left()
    return !words || turned(words) ? null : spoken
  }
  const notYet = (): HeldAnswer => {
    if (!dropLead(cjkAnswerNoLeads)) return { kind: 'notYet', change: change() }
    while (dropLead(cjkAnswerNoLeads)) {
      // "等一下，不用了": a no after it is the answer.
    }
    return { kind: 'no', change: change() }
  }
  if (dropClause(cjkAnswerClauseNo) || dropLead(cjkAnswerNoLeads)) {
    while (dropLead(cjkAnswerNoLeads)) {
      // More no is still the no.
    }
    return { kind: 'no', change: change() }
  }
  if (dropLead(cjkAnswerNotYetLeads)) return notYet()
  if (!(dropClause(cjkAnswerClauseYes) || dropLead(cjkAnswerYesLeads))) return null
  while (dropLead(cjkAnswerYesLeads)) {
    // "好的，好的".
  }
  if (dropLead(cjkAnswerNoLeads)) return { kind: 'no', change: change() }
  if (dropLead(cjkAnswerNotYetLeads)) return notYet()
  const words = left()
  if (!words) return { kind: 'yes', addition: null }
  const asks = spoken.includes('?') || spoken.includes('？') || rest.endsWith('吗') || rest.endsWith('か')
  if (turned(words) || asks) return { kind: 'other', words: spoken }
  return { kind: 'yes', addition: spoken }
}
const cjkAnswerFillersByLength = [...cjkAnswerFillers].sort((a, b) => Array.from(b).length - Array.from(a).length)
