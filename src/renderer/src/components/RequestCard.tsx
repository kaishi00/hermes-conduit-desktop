import { useState } from 'react'
import { gateway } from '../gateway'
import type { PendingRequest } from '@shared/ipc'
import { approvalView, clarifyQuestions, lockedAnswers, type ClarifyQuestion } from '../state/needsYou'
import { inputAnswer, inputPromptView, type InputPromptView } from '../state/inputPrompts'
import { answering, markExpired, noteLocked, type ExpiredQuestion } from '../state/expiredQuestions'
import { Icon } from './icons'
import { t } from '@shared/i18n'

/** An approval or a question Hermes is waiting on, answered here. */
export function RequestCard({ request, chatTitle }: { request: PendingRequest; chatTitle?: string }) {
  const input = inputPromptView(request)
  if (input) return <InputPromptCard request={request} view={input} chatTitle={chatTitle} />
  return request.method === 'approval' ? <ApprovalCard request={request} chatTitle={chatTitle} /> : <ClarifyCard request={request} chatTitle={chatTitle} />
}

function ApprovalCard({ request, chatTitle }: { request: PendingRequest; chatTitle?: string }) {
  const view = approvalView(request.params)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const answer = async (choice: string) => {
    setBusy(choice)
    setError(null)
    const ok = await window.conduit.answerRequest(request.id, { choice })
    if (!ok) setError(t('This was already answered somewhere else.'))
    setBusy(null)
  }

  return (
    <section className="ask" aria-label={t('Approval needed')}>
      <header className="ask-head">
        <span className="ask-icon">
          <Icon name="code" />
        </span>
        <span className="ask-title">
          {t('Needs your OK')}
          {chatTitle ? <span className="ask-chat"> · {chatTitle}</span> : null}
        </span>
      </header>
      <p className="ask-text">{view.description}</p>
      {view.command ? <pre className="ask-command">{view.command}</pre> : null}
      <div className="ask-actions">
        {view.choices.map(c => (
          <button key={c.choice} className={`ask-btn ${c.tone}`} disabled={busy !== null} onClick={() => void answer(c.choice)}>
            {busy === c.choice ? '…' : c.label}
          </button>
        ))}
      </div>
      {error ? <p className="ask-error">{error}</p> : null}
    </section>
  )
}

function ClarifyCard({ request, chatTitle }: { request: PendingRequest; chatTitle?: string }) {
  const questions = clarifyQuestions(request.params)
  const [locked, setLocked] = useState<Record<string, string | null>>(() => lockedAnswers(request.params))
  const [error, setError] = useState<string | null>(null)

  const lock = async (question: ClarifyQuestion, answer: string | string[] | null) => {
    setError(null)
    try {
      const result = await gateway.rpc<{ status?: string; remaining?: unknown }>('clarify.lock', {
        request_id: request.id,
        question_id: question.qid,
        answer
      })
      if (result?.status === 'expired') {
        // Kept in the chat with its choices, to answer in a message (expiredQuestions.ts).
        markExpired(request, locked)
        void window.conduit.dismissRequest(request.id)
        return
      }
      const shown = answer === null ? null : Array.isArray(answer) ? answer.join(', ') : answer
      noteLocked(request.id, question.qid, shown)
      setLocked(current => ({ ...current, [question.qid]: shown }))
      // The last answer settles the request on the gateway.
      if (Array.isArray(result?.remaining) && result.remaining.length === 0) void window.conduit.dismissRequest(request.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const skipAll = async () => {
    await window.conduit.answerRequest(request.id, {})
  }

  return (
    <section className="ask" aria-label={t('Question from Hermes')}>
      <header className="ask-head">
        <span className="ask-icon">
          <Icon name="chats" />
        </span>
        <span className="ask-title">
          {questions.length > 1 ? t('{count} questions', { count: questions.length }) : t('A question')}
          {chatTitle ? <span className="ask-chat"> · {chatTitle}</span> : null}
        </span>
      </header>
      {questions.map(q => (
        <Question key={q.qid} question={q} locked={q.qid in locked ? locked[q.qid] : undefined} onAnswer={a => void lock(q, a)} />
      ))}
      <div className="ask-actions end">
        <button className="ask-btn plain" onClick={() => void skipAll()}>
          {questions.length > 1 ? t('Skip all') : t('Skip')}
        </button>
      </div>
      {error ? <p className="ask-error">{error}</p> : null}
    </section>
  )
}

/**
 * A question Hermes stopped waiting for, after the phone's (issue 2850): what
 * it asked and offered stay, and a tapped choice (or, for an open question,
 * Answer in a message) puts the question in the draft as a quote with the
 * choice under it. With no composer to fill, the choices are listed only.
 */
export function ExpiredClarifyCard({ expired, onAnswer }: { expired: ExpiredQuestion; onAnswer?: (text: string) => void }) {
  // A batch's dismissed questions leave the card; the rest stay to answer.
  const questions = clarifyQuestions(expired.request.params).filter(q => !expired.dismissed?.includes(q.question.trim()))
  const locked = { ...lockedAnswers(expired.request.params), ...expired.locked }
  const answer = (question: string, choice: string | null) => {
    const text = answering(question, choice)
    if (text) onAnswer?.(text)
  }
  return (
    <section className="ask expired" aria-label={t('Question from Hermes')}>
      <header className="ask-head">
        <span className="ask-icon">
          <Icon name="chats" />
        </span>
        <span className="ask-title">{questions.length > 1 ? t('{count} questions', { count: questions.length }) : t('A question')}</span>
      </header>
      {questions.map(q => {
        const done = q.qid in locked
        return (
          <div key={q.qid} className={`ask-q${done ? ' done' : ''}`}>
            <p className="ask-text">{q.question}</p>
            {done ? (
              <p className="ask-locked">
                <Icon name="check" /> {locked[q.qid] === null ? t('Skipped') : locked[q.qid]}
              </p>
            ) : (
              <>
                <p className="meta">{t('No longer active')}</p>
                {onAnswer ? (
                  q.choices.length ? (
                    <>
                      <p className="meta">{t('Tap one to answer in a message.')}</p>
                      <div className="ask-choices">
                        {q.choices.map(choice => (
                          <button key={choice} className="ask-choice" title={t('Answer in a message')} onClick={() => answer(q.question, choice)}>
                            {choice}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="ask-actions">
                      <button className="ask-btn plain" onClick={() => answer(q.question, null)}>
                        {t('Answer in a message')}
                      </button>
                    </div>
                  )
                ) : q.choices.length ? (
                  <ul className="ask-choices-list">
                    {q.choices.map(choice => (
                      <li key={choice}>{choice}</li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
          </div>
        )
      })}
    </section>
  )
}

function Question({
  question,
  locked,
  onAnswer
}: {
  question: ClarifyQuestion
  /** The answer it locked; `null` skipped, undefined still open. */
  locked: string | null | undefined
  onAnswer: (answer: string | string[] | null) => void
}) {
  const [picked, setPicked] = useState<string[]>([])
  const [own, setOwn] = useState('')
  const done = locked !== undefined

  return (
    <div className={`ask-q${done ? ' done' : ''}`}>
      <p className="ask-text">{question.question}</p>
      {done ? (
        <p className="ask-locked">
          <Icon name="check" /> {locked === null ? t('Skipped') : locked}
        </p>
      ) : (
        <>
          {question.choices.length ? (
            <div className="ask-choices">
              {question.choices.map(choice =>
                question.multiSelect ? (
                  <label key={choice} className={`ask-choice${picked.includes(choice) ? ' on' : ''}`}>
                    <input
                      type="checkbox"
                      checked={picked.includes(choice)}
                      onChange={e => setPicked(p => (e.target.checked ? [...p, choice] : p.filter(c => c !== choice)))}
                    />
                    {choice}
                  </label>
                ) : (
                  <button key={choice} className="ask-choice" onClick={() => onAnswer(choice)}>
                    {choice}
                  </button>
                )
              )}
            </div>
          ) : null}
          <form
            className="ask-own"
            onSubmit={e => {
              e.preventDefault()
              if (question.multiSelect && picked.length && !own.trim()) onAnswer(picked)
              else if (own.trim()) onAnswer(question.multiSelect ? [...picked, own.trim()] : own.trim())
            }}
          >
            <input
              value={own}
              onChange={e => setOwn(e.target.value)}
              placeholder={question.choices.length ? t('Or type your own answer') : t('Type your answer')}
              aria-label={t('Your answer')}
            />
            <button type="submit" className="ask-btn primary" disabled={!own.trim() && !(question.multiSelect && picked.length)}>
              {t('Answer')}
            </button>
            <button type="button" className="ask-btn plain" onClick={() => onAnswer(null)}>
              {t('Skip')}
            </button>
          </form>
        </>
      )}
    </div>
  )
}

/** A password, secret, login or code Hermes asks for: typed here and sent once to the request, never into the chat. */
function InputPromptCard({ request, view, chatTitle }: { request: PendingRequest; view: InputPromptView; chatTitle?: string }) {
  const [value, setValue] = useState('')
  const [identifier, setIdentifier] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const answer = inputAnswer(view.kind, value, identifier)

  const respond = async (sent: string) => {
    setBusy(true)
    setError(null)
    const ok = await window.conduit.answerRequest(request.id, { value: sent })
    // What was typed goes with the card either way.
    setValue('')
    setIdentifier('')
    if (!ok) setError(t('This request is no longer active.'))
    setBusy(false)
  }

  return (
    <section className="ask input-ask" aria-label={view.title}>
      <header className="ask-head">
        <span className="ask-icon">
          <Icon name="lock" />
        </span>
        <span className="ask-title">
          {t('Input needed')}
          {chatTitle ? <span className="ask-chat"> · {chatTitle}</span> : null}
        </span>
      </header>
      <p className="ask-text">
        <strong>{view.title}</strong>
      </p>
      {view.note ? <p className="meta">{view.note}</p> : null}
      {view.detail ? <pre className="ask-command">{view.detail}</pre> : null}
      <form
        className="input-ask-fields"
        onSubmit={e => {
          e.preventDefault()
          if (answer !== null && !busy) void respond(answer)
        }}
      >
        {view.login ? (
          <input
            className="input-ask-field"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder={t('Email or username')}
            aria-label={t('Email or username')}
            value={identifier}
            disabled={busy}
            onChange={e => setIdentifier(e.target.value)}
          />
        ) : null}
        <input
          className="input-ask-field"
          type={view.masked ? 'password' : 'text'}
          autoComplete={view.kind === 'vault.code' ? 'one-time-code' : 'off'}
          spellCheck={false}
          placeholder={view.placeholder}
          aria-label={view.placeholder}
          value={value}
          disabled={busy}
          onChange={e => setValue(e.target.value)}
        />
        <div className="ask-actions">
          <button type="button" className="ask-btn" disabled={busy} onClick={() => void respond('')}>
            {view.skip}
          </button>
          <button type="submit" className="ask-btn primary" disabled={busy || answer === null}>
            {busy ? '…' : view.send}
          </button>
        </div>
      </form>
      {error ? <p className="ask-error">{error}</p> : null}
    </section>
  )
}
