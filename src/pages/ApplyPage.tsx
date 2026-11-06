/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';

interface ApplyPageProps {
  onNavigateToAdmin: () => void;
}

export default function ApplyPage({ onNavigateToAdmin }: ApplyPageProps) {
  const [name, setName] = useState('');
  const [org, setOrg] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [memo, setMemo] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [isUpdateNotice, setIsUpdateNotice] = useState(false);

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const clean = e.target.value.replace(/\s+/g, '');
    setPhone(clean);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');
    setIsUpdateNotice(false);

    const cleanName = name.trim();
    const cleanOrg = org.trim();
    const cleanEmail = email.trim();
    const cleanPhone = phone.trim();
    const cleanMemo = memo.trim();
    const phoneDigits = cleanPhone.replace(/\D/g, '');

    const miss: string[] = [];
    if (!cleanName) miss.push('이름');
    if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) miss.push('올바른 이메일');
    if (!/^[0-9\-+]{8,30}$/.test(cleanPhone) || phoneDigits.length < 8) miss.push('휴대폰 번호');
    if (!agreed) miss.push('개인정보 수집·이용 동의');

    if (miss.length > 0) {
      setFormError(`${miss.join(', ')}을(를) 올바르게 입력해 주세요.`);
      return;
    }

    setSubmitting(true);
    // Use phone digits as deterministic ID to prevent duplicate records
    const appId = `app_${phoneDigits}`;
    const newDoc = {
      name: cleanName,
      org: cleanOrg,
      email: cleanEmail,
      phone: cleanPhone,
      memo: cleanMemo,
      agreed: true,
      createdAt: new Date().toISOString(),
    };

    try {
      // Check if user previously submitted from this browser with the same phone
      const lastPhone = localStorage.getItem('swy_last_phone');
      const isRepeat = lastPhone === phoneDigits;

      await setDoc(doc(db, 'applications', appId), newDoc);
      localStorage.setItem('swy_last_phone', phoneDigits);

      if (isRepeat) {
        setIsUpdateNotice(true);
        setFormSuccess(
          `${cleanName}님의 기존 신청 내역이 확인되어, 최신 정보로 안전하게 갱신되었습니다. (중복 저장 방지 적용)`
        );
      } else {
        setIsUpdateNotice(false);
        setFormSuccess(
          `${cleanName}님의 참가 신청이 정상 접수되었습니다! 행사 안내는 등록해주신 연락처로 전송됩니다.`
        );
      }

      setName('');
      setOrg('');
      setEmail('');
      setPhone('');
      setMemo('');
      setAgreed(false);
    } catch (error) {
      setFormError('신청 접수 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
      handleFirestoreError(error, OperationType.CREATE, `applications/${appId}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main style={{ maxWidth: '640px', margin: '0 auto', display: 'grid', gap: '24px' }}>
      {/* Event Ticket Card */}
      <article className="ticket" aria-labelledby="ev-title">
        <header style={{ padding: '24px', display: 'grid', gap: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="eyebrow">Event · 참가 신청</span>
            <span className="tag" style={{ color: 'var(--ok)', background: 'var(--ok-bg)', fontWeight: 500 }}>
              ● 실시간 접수 중
            </span>
          </div>
          <h1 id="ev-title" style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0 }}>
            AI 협업 실무 밋업
          </h1>
          <dl
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr',
              gap: '4px 16px',
              margin: 0,
            }}
          >
            <dt style={{ fontSize: '0.8125rem', color: 'var(--muted)' }}>일시</dt>
            <dd style={{ margin: 0, fontWeight: 500, color: 'var(--accent)' }}>2026-11-20 (금) 19:00–21:00 KST</dd>
            <dt style={{ fontSize: '0.8125rem', color: 'var(--muted)' }}>장소</dt>
            <dd style={{ margin: 0, fontWeight: 500, color: 'var(--accent)' }}>서울 (상세 장소는 신청자에게 개별 안내)</dd>
            <dt style={{ fontSize: '0.8125rem', color: 'var(--muted)' }}>정원</dt>
            <dd style={{ margin: 0, fontWeight: 500, color: 'var(--accent)' }}>30명</dd>
            <dt style={{ fontSize: '0.8125rem', color: 'var(--muted)' }}>신청 마감</dt>
            <dd style={{ margin: 0, fontWeight: 500 }}>2026-11-18 (수) 23:59 KST</dd>
          </dl>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--muted)' }}>
            기획자·PM이 AI와 함께 일하는 방법을 사례 중심으로 나눕니다. 참가비 무료.
          </p>
        </header>

        <div className="perf" aria-hidden="true"></div>

        <section style={{ padding: '24px', display: 'grid', gap: '16px' }} aria-labelledby="form-title">
          <h2 id="form-title" style={{ fontSize: '1.125rem', fontWeight: 700, margin: 0 }}>
            참가 신청서
          </h2>

          {formSuccess && (
            <div
              className={`note ${isUpdateNotice ? 'warn' : 'ok'}`}
              role="status"
              style={{ display: 'grid', gap: '4px' }}
            >
              <strong>{isUpdateNotice ? '신청 정보 갱신 완료' : '접수 완료'}</strong>
              <span>{formSuccess}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '14px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
              <div style={{ display: 'grid', gap: '6px' }}>
                <label htmlFor="f-name" style={{ fontSize: '0.875rem', fontWeight: 500 }}>
                  이름 <span style={{ color: 'var(--accent)' }}>*</span>
                </label>
                <input
                  id="f-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  required
                  placeholder="홍길동"
                  style={{
                    font: 'inherit',
                    color: 'var(--ink)',
                    background: 'var(--bg)',
                    border: '1px solid var(--line)',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    width: '100%',
                  }}
                />
              </div>

              <div style={{ display: 'grid', gap: '6px' }}>
                <label htmlFor="f-org" style={{ fontSize: '0.875rem', fontWeight: 500 }}>
                  소속
                </label>
                <input
                  id="f-org"
                  value={org}
                  onChange={(e) => setOrg(e.target.value)}
                  autoComplete="organization"
                  placeholder="회사·학교 (선택)"
                  style={{
                    font: 'inherit',
                    color: 'var(--ink)',
                    background: 'var(--bg)',
                    border: '1px solid var(--line)',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    width: '100%',
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
              <div style={{ display: 'grid', gap: '6px' }}>
                <label htmlFor="f-email" style={{ fontSize: '0.875rem', fontWeight: 500 }}>
                  이메일 <span style={{ color: 'var(--accent)' }}>*</span>
                </label>
                <input
                  id="f-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                  placeholder="user@example.com"
                  style={{
                    font: 'inherit',
                    color: 'var(--ink)',
                    background: 'var(--bg)',
                    border: '1px solid var(--line)',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    width: '100%',
                  }}
                />
              </div>

              <div style={{ display: 'grid', gap: '6px' }}>
                <label htmlFor="f-phone" style={{ fontSize: '0.875rem', fontWeight: 500 }}>
                  휴대폰 <span style={{ color: 'var(--accent)' }}>*</span>
                </label>
                <input
                  id="f-phone"
                  type="tel"
                  value={phone}
                  onChange={handlePhoneChange}
                  autoComplete="tel"
                  placeholder="010-1234-5678"
                  required
                  style={{
                    font: 'inherit',
                    color: 'var(--ink)',
                    background: 'var(--bg)',
                    border: '1px solid var(--line)',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    width: '100%',
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gap: '6px' }}>
              <label htmlFor="f-memo" style={{ fontSize: '0.875rem', fontWeight: 500 }}>
                하고 싶은 질문이나 요청
              </label>
              <textarea
                id="f-memo"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="행사에서 다루어지길 바라는 내용이나 사전 질문을 남겨주세요 (선택 입력)"
                style={{
                  font: 'inherit',
                  color: 'var(--ink)',
                  background: 'var(--bg)',
                  border: '1px solid var(--line)',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  minHeight: '88px',
                  resize: 'vertical',
                  width: '100%',
                }}
              />
            </div>

            <label
              htmlFor="f-agree"
              style={{
                display: 'flex',
                gap: '10px',
                alignItems: 'flex-start',
                fontSize: '0.875rem',
                background: 'var(--bg)',
                borderRadius: '8px',
                padding: '12px',
                cursor: 'pointer',
              }}
            >
              <input
                id="f-agree"
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                required
                style={{ width: 'auto', marginTop: '4px' }}
              />
              <span>
                <strong>개인정보 수집·이용 동의 (필수)</strong>
                <br />
                <span style={{ color: 'var(--muted)' }}>
                  수집 항목: 이름, 이메일, 휴대폰, 소속 · 목적: 이벤트 참가 확인 및 안내 · 보유 기간: 이벤트 종료 후 3개월
                </span>
              </span>
            </label>

            {formError && <p className="note warn">{formError}</p>}

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="submit"
                disabled={submitting}
                style={{
                  font: 'inherit',
                  fontWeight: 500,
                  borderRadius: '8px',
                  padding: '12px 24px',
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  border: '1px solid var(--accent)',
                  background: 'var(--accent)',
                  color: 'var(--accent-ink)',
                  opacity: submitting ? 0.7 : 1,
                  fontSize: '0.95rem',
                }}
              >
                {submitting ? '신청서 제출 중...' : '신청하기'}
              </button>
            </div>
          </form>
        </section>
      </article>

      {/* Footer navigation for organizer */}
      <footer style={{ textAlign: 'center', paddingTop: '8px', paddingBottom: '24px' }}>
        <button
          type="button"
          onClick={onNavigateToAdmin}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--muted)',
            fontSize: '0.8125rem',
            cursor: 'pointer',
            textDecoration: 'underline',
            padding: '6px 12px',
          }}
        >
          주최자 관리자 페이지 (/admin) →
        </button>
      </footer>
    </main>
  );
}
