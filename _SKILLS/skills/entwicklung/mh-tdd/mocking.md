# Wann Mocks sinnvoll sind

Setze Test-Doubles an **Systemgrenzen** ein: etwa für externe Zahlungs- oder Mail-Dienste, Zeit und Zufall oder bei Bedarf das Dateisystem. Bei Datenbanken ist eine Testdatenbank oft aussagekräftiger als ein Mock. Eigene Module und interne Zusammenarbeit möglichst echt lassen.

## Externe Abhängigkeiten übergeben

```typescript
// Der Test kann einen kontrollierten Zahlungsdienst übergeben.
function processPayment(order, paymentClient) {
  return paymentClient.charge(order.total);
}
```

Wenn die Funktion den Client selbst aus Umgebungsvariablen konfiguriert und erstellt, muss der Test wesentlich mehr Umgebung nachbauen oder interne Details abfangen.

## Konkrete Operationen statt eines generischen Fetchers

```typescript
const api = {
  getUser: (id) => fetch(`/users/${id}`),
  getOrders: (userId) => fetch(`/orders?userId=${userId}`),
  createUser: (data) => fetch("/users", { method: "POST", body: JSON.stringify(data) }),
};
```

Hinter einer solchen Schnittstelle kann jeder Mock eine klar definierte Antwort liefern. Der Testaufbau braucht keine Fallunterscheidung nach URL oder HTTP-Methode, und beim Lesen des Tests ist sofort klar, welche externe Operation beteiligt ist.
