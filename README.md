# 🧪 Smart Contract Testing Suite (Hardhat)

## 📌 Introduction

This repository contains **comprehensive smart contract test cases** built using **Hardhat**.
It covers both:

* ✅ Positive test cases (expected behavior)
* ❌ Negative test cases (security & failure scenarios)

Additionally, the project includes:

* 📊 **Code coverage reports**
* ⛽ **Gas usage reports per function**

The test structure is modular and organized by contract domains:

* `erc20`
* `presale`
* `staking`
* `governance`

---

## ⚙️ Installation

Install all dependencies:

```bash
npm install
```

---

## 🚀 How It Works

### 1. Clean previous builds

```bash
npx hardhat clean
```

### 2. Compile smart contracts

```bash
npx hardhat compile
```

### 3. Run all tests with coverage

```bash
npx hardhat coverage
```

### 4. Run tests with gas report

```bash
REPORT_GAS=true npx hardhat test
```

---

## 🧪 Run Specific Test Suites

### ERC20 Tests

```bash
npx hardhat test test/erc20/Vittagems.test.js
npx hardhat test test/erc20/Vittagems.security.test.js
npx hardhat test "test/erc20/**"
```

### Presale Tests

```bash
npx hardhat test test/presale/VittagemsPresale.test.js
npx hardhat test test/presale/VittagemsPresale.security.test.js
npx hardhat test "test/presale/**"
```

### Staking Tests

```bash
npx hardhat test test/staking/TokenStaking.test.js
npx hardhat test test/staking/TokenStaking.security.test.js
npx hardhat test "test/staking/**"
```

### Governance Tests

```bash
npx hardhat test test/governance/DOVGovernance.test.js
npx hardhat test test/governance/DOVGovernance.security.test.js
npx hardhat test "test/governance/**"
```

---

## ⛽ Run Gas Report for Specific Tests

### ERC20

```bash
REPORT_GAS=true npx hardhat test test/erc20/Vittagems.test.js
```

### Presale

```bash
REPORT_GAS=true npx hardhat test test/presale/VittagemsPresale.test.js
```

### Staking

```bash
REPORT_GAS=true npx hardhat test test/staking/TokenStaking.test.js
```

### Governance

```bash
REPORT_GAS=true npx hardhat test test/governance/DOVGovernance.test.js
```

## 📊 Reports

* **Coverage Report:** Generated via `hardhat coverage`
* **Gas Report:** Enabled using `REPORT_GAS=true`

---

## ⚠️ Notes

* All smart contract functionalities are implemented **as per client requirements**.
* Coverage and gas report files are already included in the repository.
  You may refer to them directly if you prefer not to run tests locally.
* Mock contracts are used **only for testing purposes** (positive & negative scenarios).
* Only the **4 main contracts** are intended for audit; mocks are not part of the audit scope.

---

## ✅ Summary

This repository ensures:

* Full **functional validation**
* Strong **security testing**
* Transparent **gas optimization insights**

---
