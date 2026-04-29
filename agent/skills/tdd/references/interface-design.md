# Interface Design

## 1. Accept dependencies, don't create them

```typescript
// Testable
function processOrder(order, paymentGateway) {}

// Hard to test
function processOrder(order) {
  const gateway = new StripeGateway();
}
```

## 2. Return results, don't produce side effects

```typescript
// Testable
function calculateDiscount(cart): Discount {}

// Hard to test
function applyDiscount(cart): void {
  cart.total -= discount;
}
```

## 3. Aim for a Small surface area

- Fewer methods needs fewer tests
- Fewer params represents a simpler test setup
