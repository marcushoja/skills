# Gute und schlechte Tests

## Gut: sichtbares Verhalten prüfen

```typescript
test("Ein gültiger Warenkorb kann bestellt werden", async () => {
  const cart = createCart();
  cart.add(product);

  const result = await checkout(cart, paymentMethod);

  expect(result.status).toBe("confirmed");
});
```

Der Test nutzt die öffentliche Schnittstelle und benennt, was für Aufrufer zählt. Er prüft eine fachliche Aussage und übersteht interne Umbauten.

## Schlecht: die Implementierung festschreiben

Ein Test, der nur prüft, ob `checkout` intern `paymentService.process` aufruft, sagt nicht, ob die Bestellung aus Sicht des Aufrufers bestätigt wurde. Ähnlich verräterisch sind Tests, die private Methoden direkt aufrufen oder ohne fachlichen Grund Anzahl und Reihenfolge interner Aufrufe festlegen.

Auch der Prüfweg sollte zur Schnittstelle gehören: Statt bei `createUser` direkt die Datenbankzeile abzufragen, lies den Benutzer über die dafür vorgesehene öffentliche Funktion wieder ein:

```typescript
test("Ein angelegter Benutzer ist abrufbar", async () => {
  const user = await createUser({ name: "Alice" });

  const retrieved = await getUser(user.id);

  expect(retrieved.name).toBe("Alice");
});
```

## Schlecht: denselben Algorithmus als Sollwert verwenden

Wenn Produktion und Test dieselbe Summenberechnung verwenden, können sie denselben Fehler machen. Nutze stattdessen einen unabhängig bestimmten Wert:

```typescript
test("Die Gesamtsumme enthält beide Positionen", () => {
  expect(calculateTotal([{ price: 10 }, { price: 5 }])).toBe(15);
});
```
