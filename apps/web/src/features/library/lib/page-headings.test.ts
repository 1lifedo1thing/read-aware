import { expect, test } from "bun:test";
import { detectPageHeadings } from "./page-headings";

test("chapter openers at the top of a page become headings; contents pages do not", () => {
  const pages = [
    "把时间当作朋友\n李笑来",
    "目录\n第 0 章 困境 1\n第 1 章 醒悟 9\n第 2 章 现实 21",
    "第 0 章 困境\n1. 问题\n正文……",
    "正文继续……",
    "第 1 章 醒悟\n1. 孰主孰仆\n正文……",
  ];
  expect(detectPageHeadings(pages)).toEqual([
    { page: 2, offset: 0, label: "第 0 章 困境" },
    { page: 4, offset: 0, label: "第 1 章 醒悟" },
  ]);
});

test("a running head starts its chapter on the headingless opener before it", () => {
  const pages = [
    "Contents\nChapter 1 Lagrangian Mechanics 1\nChapter 2 Rigid Bodies 119\nChapter 3 Hamiltonian Mechanics 189",
    "1\nLagrangian Mechanics\nThe subject of this book is motion…",
    "2 Chapter 1 Lagrangian Mechanics\nother conceivable motions?",
    "Chapter 1 Lagrangian Mechanics 3\nMechanics, as invented by Newton…",
    "2\nRigid Bodies\nRigid bodies cannot…",
    "120 Chapter 2 Rigid Bodies\nThe kinetic energy…",
    "Chapter 2 Rigid Bodies 121\nmore",
  ];
  expect(detectPageHeadings(pages)).toEqual([
    { page: 1, offset: 0, label: "Chapter 1 Lagrangian Mechanics" },
    { page: 4, offset: 0, label: "Chapter 2 Rigid Bodies" },
  ]);
});

test("a heading below a short running line keeps its offset in the page text", () => {
  const pages = ["序言\n正文", "12\n第二章 起源\n正文", "13\n第三章 发展\n正文"];
  expect(detectPageHeadings(pages)).toEqual([
    { page: 1, offset: 3, label: "第二章 起源" },
    { page: 2, offset: 3, label: "第三章 发展" },
  ]);
});

test("a lone heading or none is no outline", () => {
  expect(detectPageHeadings(["第一章 开始\n正文", "正文"])).toEqual([]);
  expect(detectPageHeadings(["Photographs", "", "Plate 3"])).toEqual([]);
});
