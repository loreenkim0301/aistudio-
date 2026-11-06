/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useId, useMemo, useRef } from 'react';
import {
  collection,
  doc,
  deleteDoc,
  setDoc,
  getDoc,
  onSnapshot,
  query,
  orderBy,
  type Unsubscribe,
} from 'firebase/firestore';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  db,
  auth,
  signInWithGoogleOrganizer,
  logoutOrganizer,
  getCachedAccessToken,
  handleFirestoreError,
  OperationType,
} from '../firebase';
import {
  createEventSpreadsheet,
  appendAttendeesToSheet,
  type ApplicationRecord,
} from '../services/googleSheets';

const ADMIN_EMAIL = 'loreen@selectway.co.kr';

function fmtKST(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return iso || '';
  }
}

interface AdminPageProps {
  onNavigateToApply: () => void;
}

export default function AdminPage({ onNavigateToApply }: AdminPageProps) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(getCachedAccessToken());
  const [authLoading, setAuthLoading] = useState(true);
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [deleteArmId, setDeleteArmId] = useState<string | null>(null);
  const [copyMsg, setCopyMsg] = useState('');
  const [tsvFallback, setTsvFallback] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const copyAreaId = useId();

  // Google Sheets state
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [spreadsheetUrl, setSpreadsheetUrl] = useState('');
  const [autoSync, setAutoSync] = useState(true);
  const [syncStatus, setSyncStatus] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [inputCustomSheet, setInputCustomSheet] = useState('');
  const [showSheetInput, setShowSheetInput] = useState(false);

  const isOrganizer = currentUser?.email === ADMIN_EMAIL;
  const isFirstSyncRef = useRef(true);

  // Track Firebase Auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setAuthLoading(false);
      setAccessToken(getCachedAccessToken());
    });
    return () => unsub();
  }, []);

  // Load saved Google Sheet settings from Firestore
  useEffect(() => {
    if (!currentUser || !isOrganizer) return;

    const loadSettings = async () => {
      try {
        const snap = await getDoc(doc(db, 'settings', 'google_sheets'));
        if (snap.exists()) {
          const data = snap.data();
          if (data.spreadsheetId) setSpreadsheetId(data.spreadsheetId);
          if (data.spreadsheetUrl) setSpreadsheetUrl(data.spreadsheetUrl);
          if (typeof data.autoSync === 'boolean') setAutoSync(data.autoSync);
        }
      } catch (err) {
        console.warn('설정 로드 중 경고 (아직 생성되지 않음):', err);
      }
    };

    loadSettings();
  }, [currentUser, isOrganizer]);

  // Listen for applications in real-time when authenticated as organizer
  useEffect(() => {
    if (!currentUser || !isOrganizer) {
      setApplications([]);
      setListLoading(false);
      return;
    }

    setListLoading(true);
    setListError('');

    const appQuery = query(
      collection(db, 'applications'),
      orderBy('createdAt', 'desc')
    );

    let unsub: Unsubscribe;
    try {
      unsub = onSnapshot(
        appQuery,
        (snapshot) => {
          const list: ApplicationRecord[] = [];
          snapshot.forEach((d) => {
            list.push({ id: d.id, ...(d.data() as Omit<ApplicationRecord, 'id'>) });
          });
          setApplications(list);
          setListLoading(false);
        },
        (error) => {
          setListLoading(false);
          setListError('신청자 목록을 불러오는 중 오류가 발생했습니다.');
          handleFirestoreError(error, OperationType.LIST, 'applications');
        }
      );
    } catch (error) {
      setListLoading(false);
      handleFirestoreError(error, OperationType.LIST, 'applications');
    }

    return () => {
      if (unsub) unsub();
    };
  }, [currentUser, isOrganizer]);

  // Auto-sync new applicants to Google Sheets when new applicants arrive
  useEffect(() => {
    if (!autoSync || !spreadsheetId || !accessToken || applications.length === 0) {
      return;
    }

    // Skip the very first initial mount if already handled
    const doAutoSync = async () => {
      try {
        const { addedCount, skippedCount } = await appendAttendeesToSheet(
          spreadsheetId,
          applications,
          accessToken
        );
        if (addedCount > 0) {
          setSyncStatus(`구글 시트 자동 동기화: 신규 신청자 ${addedCount}명 추가 완료 (중복 ${skippedCount}명 스킵)`);
        } else if (isFirstSyncRef.current) {
          setSyncStatus(`구글 시트 연동 상태: 최신 동기화 완료 (${skippedCount}명 확인)`);
          isFirstSyncRef.current = false;
        }
      } catch (err) {
        console.warn('시트 자동 동기화 에러:', err);
      }
    };

    const timer = setTimeout(doAutoSync, 1200);
    return () => clearTimeout(timer);
  }, [applications, autoSync, spreadsheetId, accessToken]);

  // Google Login for Organizer
  const handleGoogleLogin = async () => {
    try {
      const { user, accessToken: token } = await signInWithGoogleOrganizer();
      setCurrentUser(user);
      setAccessToken(token);
    } catch (error) {
      console.error('로그인 실패:', error);
      alert('Google 로그인에 실패했습니다. 다시 시도해 주세요.');
    }
  };

  // Logout
  const handleLogout = async () => {
    try {
      await logoutOrganizer();
      setAccessToken(null);
    } catch (error) {
      console.error('로그아웃 실패:', error);
    }
  };

  // Create New Google Spreadsheet
  const handleCreateNewSheet = async () => {
    if (!accessToken) {
      alert('구글 시트 연동을 위해 먼저 주최자 로그인을 진행해 주세요.');
      return;
    }

    setIsSyncing(true);
    setSyncStatus('새 구글 스프레드시트를 생성하고 있습니다...');

    try {
      const { spreadsheetId: newId, spreadsheetUrl: newUrl } = await createEventSpreadsheet(
        'AI 협업 실무 밋업 - 참가 신청자 명단',
        accessToken
      );

      setSpreadsheetId(newId);
      setSpreadsheetUrl(newUrl);

      // Save to Firestore settings
      await setDoc(doc(db, 'settings', 'google_sheets'), {
        spreadsheetId: newId,
        spreadsheetUrl: newUrl,
        autoSync: true,
        updatedAt: new Date().toISOString(),
      });

      // Populate current applications without duplicates
      if (applications.length > 0) {
        setSyncStatus('생성된 시트에 기존 신청자 명단을 등록하는 중...');
        const { addedCount } = await appendAttendeesToSheet(newId, applications, accessToken);
        setSyncStatus(`새 구글 시트가 연결되었습니다! ${addedCount}명의 신청자가 동기화되었습니다.`);
      } else {
        setSyncStatus('새 구글 시트가 성공적으로 생성 및 연결되었습니다.');
      }
    } catch (err) {
      console.error('시트 생성 오류:', err);
      setSyncStatus(`시트 생성 중 오류: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSyncing(false);
    }
  };

  // Connect Existing Sheet
  const handleConnectExistingSheet = async () => {
    if (!inputCustomSheet.trim()) return;

    let targetId = inputCustomSheet.trim();
    // Extract ID if URL is provided
    const match = targetId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (match && match[1]) {
      targetId = match[1];
    }

    const targetUrl = `https://docs.google.com/spreadsheets/d/${targetId}/edit`;

    setIsSyncing(true);
    setSyncStatus('기존 스프레드시트 연결 확인 중...');

    try {
      setSpreadsheetId(targetId);
      setSpreadsheetUrl(targetUrl);

      await setDoc(doc(db, 'settings', 'google_sheets'), {
        spreadsheetId: targetId,
        spreadsheetUrl: targetUrl,
        autoSync: true,
        updatedAt: new Date().toISOString(),
      });

      if (accessToken && applications.length > 0) {
        const { addedCount, skippedCount } = await appendAttendeesToSheet(
          targetId,
          applications,
          accessToken
        );
        setSyncStatus(`기존 시트 연결 완료! 신규 ${addedCount}명 추가, 기존 중복 ${skippedCount}명 확인.`);
      } else {
        setSyncStatus('기존 스프레드시트가 연결되었습니다.');
      }
      setShowSheetInput(false);
    } catch (err) {
      setSyncStatus(`연결 오류: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSyncing(false);
    }
  };

  // Manual Trigger: Sync Now to Google Sheets
  const handleManualSync = async () => {
    if (!spreadsheetId) {
      alert('먼저 구글 스프레드시트를 생성하거나 연결해 주세요.');
      return;
    }
    if (!accessToken) {
      alert('스프레드시트 수정 권한을 확인하기 위해 다시 로그인해 주세요.');
      return;
    }

    setIsSyncing(true);
    setSyncStatus('스프레드시트와 중복 대조 및 동기화 진행 중...');

    try {
      const { addedCount, skippedCount } = await appendAttendeesToSheet(
        spreadsheetId,
        applications,
        accessToken
      );
      setSyncStatus(
        `동기화 완료: 신규 ${addedCount}명 추가됨 (기존 ${skippedCount}명 중복 방지 스킵)`
      );
    } catch (err) {
      setSyncStatus(`동기화 실패: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSyncing(false);
    }
  };

  // Delete Application (Two-step confirmation)
  const handleDelete = async (id: string) => {
    if (deleteArmId !== id) {
      setDeleteArmId(id);
      setTimeout(() => {
        setDeleteArmId((cur) => (cur === id ? null : cur));
      }, 4000);
      return;
    }

    try {
      await deleteDoc(doc(db, 'applications', id));
      setDeleteArmId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `applications/${id}`);
    }
  };

  // Copy TSV for Google Sheets clipboard fallback
  const handleCopyTSV = () => {
    if (applications.length === 0) {
      setCopyMsg('복사할 신청자가 없습니다.');
      return;
    }

    const head = ['신청시각(KST)', '이름', '소속', '이메일', '휴대폰', '질문·요청'];
    const rows = applications.map((r) => [
      fmtKST(r.createdAt),
      r.name,
      r.org,
      r.email,
      r.phone,
      (r.memo || '').replace(/\s+/g, ' '),
    ]);
    const tsv = [head, ...rows].map((arr) => arr.join('\t')).join('\n');

    const fallback = () => {
      setTsvFallback(tsv);
      setCopyMsg('자동 클립보드가 제한되어 아래 텍스트 상자에 생성되었습니다.');
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(tsv)
        .then(() => {
          setTsvFallback('');
          setCopyMsg(`${applications.length}명의 명단이 복사되었습니다. 구글 시트에 바로 붙여넣으세요.`);
        })
        .catch(() => fallback());
    } else {
      fallback();
    }
  };

  // Filtered applications by search keyword
  const filteredApplications = useMemo(() => {
    if (!searchQuery.trim()) return applications;
    const q = searchQuery.toLowerCase().trim();
    return applications.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.org && a.org.toLowerCase().includes(q)) ||
        a.email.toLowerCase().includes(q) ||
        a.phone.includes(q) ||
        (a.memo && a.memo.toLowerCase().includes(q))
    );
  }, [applications, searchQuery]);

  return (
    <main style={{ maxWidth: '880px', margin: '0 auto', display: 'grid', gap: '24px' }}>
      {/* Admin Top Navigation */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <button
            type="button"
            onClick={onNavigateToApply}
            style={{
              font: 'inherit',
              fontSize: '0.875rem',
              fontWeight: 500,
              padding: '8px 14px',
              borderRadius: '8px',
              border: '1px solid var(--line)',
              background: 'var(--paper)',
              color: 'var(--ink)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            ← 신청 페이지로 돌아가기
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="tag" style={{ fontFamily: 'var(--f-mono)' }}>
            Path: /admin
          </span>
          <span className="tag" style={{ color: 'var(--accent)', background: 'var(--bg)' }}>
            주최자 전용
          </span>
        </div>
      </div>

      {/* Main Admin Card */}
      <section
        className="list"
        style={{
          background: 'var(--paper)',
          border: '1px solid var(--line)',
          borderRadius: '14px',
          padding: '24px',
          display: 'grid',
          gap: '20px',
        }}
        aria-labelledby="admin-title"
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <span className="eyebrow">Organizer Dashboard</span>
            <h1 id="admin-title" style={{ fontSize: '1.5rem', fontWeight: 700, margin: '4px 0 0' }}>
              이벤트 참가 신청자 관리
            </h1>
            <p style={{ margin: '4px 0 0', fontSize: '0.875rem', color: 'var(--muted)' }}>
              AI 협업 실무 밋업 (2026-11-20 서울)
            </p>
          </div>

          {isOrganizer && (
            <div style={{ textAlign: 'right' }}>
              <div
                style={{
                  fontFamily: 'var(--f-mono)',
                  fontSize: '1.5rem',
                  fontWeight: 700,
                  color: 'var(--accent)',
                }}
              >
                {applications.length}명
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>정원 30명</div>
            </div>
          )}
        </div>

        {authLoading ? (
          <p className="note info">인증 상태를 확인하고 있습니다...</p>
        ) : !currentUser ? (
          <div style={{ display: 'grid', gap: '16px', background: 'var(--bg)', padding: '24px', borderRadius: '12px', border: '1px solid var(--line)' }}>
            <div>
              <h3 style={{ margin: '0 0 8px', fontSize: '1.1rem' }}>주최자 로그인이 필요합니다</h3>
              <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--muted)', lineHeight: 1.6 }}>
                신청자 명단 및 구글 스프레드시트 자동 동기화 기능은 주최자 계정(
                <strong>{ADMIN_EMAIL}</strong>)으로 로그인 시 활성화됩니다.
              </p>
            </div>
            <div>
              <button
                type="button"
                onClick={handleGoogleLogin}
                style={{
                  font: 'inherit',
                  fontWeight: 500,
                  borderRadius: '8px',
                  padding: '12px 20px',
                  cursor: 'pointer',
                  border: '1px solid var(--accent)',
                  background: 'var(--accent)',
                  color: 'var(--accent-ink)',
                  fontSize: '0.95rem',
                }}
              >
                주최자 Google 계정으로 로그인
              </button>
            </div>
          </div>
        ) : !isOrganizer ? (
          <div style={{ display: 'grid', gap: '16px', background: 'var(--warn-bg)', padding: '20px', borderRadius: '12px', border: '1px solid var(--warn)' }}>
            <div>
              <h3 style={{ margin: '0 0 8px', fontSize: '1.05rem', color: 'var(--warn)' }}>
                권한이 없는 계정입니다
              </h3>
              <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--ink)', lineHeight: 1.6 }}>
                현재 로그인된 계정(<strong>{currentUser.email}</strong>)은 주최자 관리 권한이 부여되지 않았습니다.
                주최자 계정인 <strong>{ADMIN_EMAIL}</strong>으로 다시 로그인해 주세요.
              </p>
            </div>
            <div>
              <button
                type="button"
                onClick={handleLogout}
                style={{
                  font: 'inherit',
                  fontWeight: 500,
                  borderRadius: '8px',
                  padding: '8px 16px',
                  cursor: 'pointer',
                  border: '1px solid var(--line)',
                  background: 'var(--paper)',
                  color: 'var(--ink)',
                }}
              >
                로그아웃 후 주최자 계정으로 로그인
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '20px' }}>
            {/* Status bar */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '10px',
                background: 'var(--ok-bg)',
                padding: '10px 14px',
                borderRadius: '8px',
                border: '1px solid var(--ok)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: 'var(--ok)', fontSize: '0.875rem', fontWeight: 600 }}>
                  ● 주최자 인증 완료: {currentUser.email}
                </span>
                <span className="tag" style={{ background: 'rgba(255,255,255,0.7)', color: 'var(--ok)' }}>
                  Firestore 실시간 연동
                </span>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                style={{
                  font: 'inherit',
                  fontSize: '0.8125rem',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  border: '1px solid var(--line)',
                  background: 'var(--paper)',
                  color: 'var(--muted)',
                  cursor: 'pointer',
                }}
              >
                로그아웃
              </button>
            </div>

            {/* Google Sheets Integration Card */}
            <div
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--line)',
                borderRadius: '10px',
                padding: '16px 18px',
                display: 'grid',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                    📊 Google Sheets 실시간 자동 연동
                  </span>
                  <span
                    className="tag"
                    style={{
                      color: spreadsheetId ? 'var(--ok)' : 'var(--muted)',
                      background: spreadsheetId ? 'var(--ok-bg)' : 'transparent',
                      border: '1px solid var(--line)',
                    }}
                  >
                    {spreadsheetId ? '연동 활성' : '미연동'}
                  </span>
                  <span className="tag" style={{ color: 'var(--accent)' }}>
                    중복 방지 적용됨
                  </span>
                </div>

                {spreadsheetUrl && (
                  <a
                    href={spreadsheetUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      font: 'inherit',
                      fontSize: '0.8125rem',
                      fontWeight: 500,
                      color: 'var(--accent)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      textDecoration: 'none',
                    }}
                  >
                    🔗 구글 스프레드시트 열기 ↗
                  </a>
                )}
              </div>

              {spreadsheetId ? (
                <div style={{ display: 'grid', gap: '8px' }}>
                  <div style={{ fontSize: '0.8125rem', color: 'var(--muted)' }}>
                    연동 시트 ID: <code style={{ fontFamily: 'var(--f-mono)' }}>{spreadsheetId}</code>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                    <button
                      type="button"
                      onClick={handleManualSync}
                      disabled={isSyncing}
                      style={{
                        font: 'inherit',
                        fontSize: '0.8125rem',
                        fontWeight: 500,
                        padding: '6px 14px',
                        borderRadius: '6px',
                        border: '1px solid var(--accent)',
                        background: 'var(--accent)',
                        color: 'var(--accent-ink)',
                        cursor: isSyncing ? 'not-allowed' : 'pointer',
                        opacity: isSyncing ? 0.7 : 1,
                      }}
                    >
                      {isSyncing ? '동기화 중...' : '지금 즉시 시트 동기화'}
                    </button>

                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.8125rem', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={autoSync}
                        onChange={(e) => setAutoSync(e.target.checked)}
                      />
                      <span>신규 신청 시 즉시 자동 누적 (Auto-sync)</span>
                    </label>

                    <button
                      type="button"
                      onClick={() => setShowSheetInput(!showSheetInput)}
                      style={{
                        font: 'inherit',
                        fontSize: '0.75rem',
                        background: 'none',
                        border: 'none',
                        color: 'var(--muted)',
                        cursor: 'pointer',
                        textDecoration: 'underline',
                      }}
                    >
                      다른 시트로 변경
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'grid', gap: '10px' }}>
                  <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--muted)', lineHeight: 1.5 }}>
                    신청자가 접수되는 즉시 구글 스프레드시트에 행이 자동으로 쌓이도록 연동합니다. 전화번호 및 신청 ID를 대조하여 중복 행은 자동으로 걸러집니다.
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={handleCreateNewSheet}
                      disabled={isSyncing}
                      style={{
                        font: 'inherit',
                        fontSize: '0.875rem',
                        fontWeight: 500,
                        padding: '8px 16px',
                        borderRadius: '6px',
                        border: '1px solid var(--accent)',
                        background: 'var(--accent)',
                        color: 'var(--accent-ink)',
                        cursor: isSyncing ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {isSyncing ? '생성 중...' : '새 구글 스프레드시트 생성 및 자동 연동'}
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowSheetInput(!showSheetInput)}
                      style={{
                        font: 'inherit',
                        fontSize: '0.875rem',
                        fontWeight: 500,
                        padding: '8px 14px',
                        borderRadius: '6px',
                        border: '1px solid var(--line)',
                        background: 'var(--paper)',
                        color: 'var(--ink)',
                        cursor: 'pointer',
                      }}
                    >
                      기존 시트 URL 입력하여 연동
                    </button>
                  </div>
                </div>
              )}

              {showSheetInput && (
                <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                  <input
                    type="text"
                    value={inputCustomSheet}
                    onChange={(e) => setInputCustomSheet(e.target.value)}
                    placeholder="기존 구글 시트 URL 또는 스프레드시트 ID 붙여넣기"
                    style={{
                      flex: 1,
                      font: 'inherit',
                      fontSize: '0.8125rem',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--line)',
                      background: 'var(--paper)',
                      color: 'var(--ink)',
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleConnectExistingSheet}
                    disabled={isSyncing}
                    style={{
                      font: 'inherit',
                      fontSize: '0.8125rem',
                      fontWeight: 500,
                      padding: '8px 14px',
                      borderRadius: '6px',
                      border: '1px solid var(--accent)',
                      background: 'var(--accent)',
                      color: 'var(--accent-ink)',
                      cursor: 'pointer',
                    }}
                  >
                    연동하기
                  </button>
                </div>
              )}

              {syncStatus && (
                <p className="note info" style={{ margin: 0, padding: '8px 12px', fontSize: '0.8125rem' }}>
                  {syncStatus}
                </p>
              )}
            </div>

            {/* Action Bar & Search */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', gap: '8px', flex: '1 1 240px', maxWidth: '360px' }}>
                <input
                  type="text"
                  placeholder="이름, 소속, 이메일, 전화번호 검색..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    font: 'inherit',
                    fontSize: '0.875rem',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--line)',
                    background: 'var(--bg)',
                    color: 'var(--ink)',
                    width: '100%',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={handleCopyTSV}
                  style={{
                    font: 'inherit',
                    fontWeight: 500,
                    fontSize: '0.875rem',
                    borderRadius: '8px',
                    padding: '8px 16px',
                    cursor: 'pointer',
                    border: '1px solid var(--line)',
                    background: 'var(--paper)',
                    color: 'var(--ink)',
                  }}
                >
                  명단 클립보드 복사 (TSV)
                </button>
              </div>
            </div>

            {copyMsg && <p className="note info" style={{ margin: 0 }}>{copyMsg}</p>}
            {listError && <p className="note warn" style={{ margin: 0 }}>{listError}</p>}

            {tsvFallback && (
              <textarea
                id={copyAreaId}
                readOnly
                value={tsvFallback}
                aria-label="복사용 명단 텍스트"
                style={{
                  minHeight: '120px',
                  fontFamily: 'var(--f-mono)',
                  fontSize: '0.8rem',
                  padding: '10px',
                  borderRadius: '8px',
                  border: '1px solid var(--line)',
                  background: 'var(--bg)',
                  color: 'var(--ink)',
                  width: '100%',
                }}
                onFocus={(e) => e.target.select()}
              />
            )}

            {/* Table of Applicants */}
            <div style={{ overflowX: 'auto', border: '1px solid var(--line)', borderRadius: '8px' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.875rem', minWidth: '650px' }}>
                <thead>
                  <tr style={{ background: 'var(--bg)' }}>
                    <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--line)', fontSize: '0.75rem', color: 'var(--muted)' }}>
                      No.
                    </th>
                    <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--line)', fontSize: '0.75rem', color: 'var(--muted)' }}>
                      신청 시각 (KST)
                    </th>
                    <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--line)', fontSize: '0.75rem', color: 'var(--muted)' }}>
                      이름
                    </th>
                    <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--line)', fontSize: '0.75rem', color: 'var(--muted)' }}>
                      소속
                    </th>
                    <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--line)', fontSize: '0.75rem', color: 'var(--muted)' }}>
                      이메일
                    </th>
                    <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--line)', fontSize: '0.75rem', color: 'var(--muted)' }}>
                      휴대폰
                    </th>
                    <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--line)', fontSize: '0.75rem', color: 'var(--muted)' }}>
                      질문·요청
                    </th>
                    <th style={{ textAlign: 'center', padding: '10px 12px', borderBottom: '1px solid var(--line)', fontSize: '0.75rem', color: 'var(--muted)' }}>
                      관리
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {listLoading ? (
                    <tr>
                      <td colSpan={8} style={{ padding: '32px 10px', textAlign: 'center', color: 'var(--muted)' }}>
                        실시간 데이터를 불러오는 중...
                      </td>
                    </tr>
                  ) : filteredApplications.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ padding: '32px 10px', textAlign: 'center', color: 'var(--muted)' }}>
                        {searchQuery ? '검색 결과와 일치하는 신청자가 없습니다.' : '아직 접수된 참가 신청자가 없습니다.'}
                      </td>
                    </tr>
                  ) : (
                    filteredApplications.map((r, idx) => {
                      const isArmed = deleteArmId === r.id;
                      return (
                        <tr key={r.id}>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', fontVariantNumeric: 'tabular-nums', color: 'var(--muted)', fontSize: '0.8rem' }}>
                            {filteredApplications.length - idx}
                          </td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                            {fmtKST(r.createdAt)}
                          </td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', fontWeight: 600 }}>
                            {r.name}
                          </td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>
                            {r.org || '-'}
                          </td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>
                            <a href={`mailto:${r.email}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                              {r.email}
                            </a>
                          </td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', fontVariantNumeric: 'tabular-nums' }}>
                            <a href={`tel:${r.phone}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                              {r.phone}
                            </a>
                          </td>
                          <td
                            style={{
                              padding: '10px 12px',
                              borderBottom: '1px solid var(--line)',
                              maxWidth: '180px',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                            title={r.memo}
                          >
                            {r.memo || '-'}
                          </td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', textAlign: 'center' }}>
                            <button
                              type="button"
                              onClick={() => handleDelete(r.id)}
                              style={{
                                font: 'inherit',
                                fontSize: '0.8125rem',
                                padding: '4px 10px',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                border: '1px solid var(--warn)',
                                background: isArmed ? 'var(--warn)' : 'transparent',
                                color: isArmed ? '#fff' : 'var(--warn)',
                                whiteSpace: 'nowrap',
                                transition: 'all 0.15s ease',
                              }}
                            >
                              {isArmed ? '삭제 확인' : '삭제'}
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
