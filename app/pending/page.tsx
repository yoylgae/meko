"use client";
import { useMe } from "../Shell";

export default function Pending() {
  const { me, reload } = useMe();
  const disabled = me?.user.status === "disabled";
  return (
    <section className="card notice">
      <h2>{disabled ? "사용이 정지된 계정입니다" : "관리자 승인을 기다리는 중입니다"}</h2>
      <p>
        {disabled
          ? "관리자에게 문의하세요."
          : `${me?.user.name ?? ""}님(${me?.user.email ?? ""})의 가입 신청이 접수되었습니다. 관리자가 승인하고 현장을 배정하면 바로 사용할 수 있어요.`}
      </p>
      {!disabled && <button className="ghost" onClick={reload}>승인됐는지 다시 확인</button>}
    </section>
  );
}
