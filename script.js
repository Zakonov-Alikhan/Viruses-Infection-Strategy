// Определение переменных и констант
const boardSize = 15;
let board = [];
let currentPlayer = "X"; // Начинает игрок X

// Функция для создания игровой доски
function createBoard() {
    for (let i = 0; i < boardSize; i++) {
        board[i] = [];
        for (let j = 0; j < boardSize; j++) {
            board[i][j] = "";
        }
    }
}

// Функция для отрисовки игровой доски в HTML
function renderBoard() {
    const gameBoard = document.querySelector(".game-board");
    gameBoard.innerHTML = "";

    for (let i = 0; i < boardSize; i++) {
        const row = document.createElement("div");
        row.classList.add("row");

        for (let j = 0; j < boardSize; j++) {
            const cell = document.createElement("div");
            cell.classList.add("cell");
            cell.dataset.row = i;
            cell.dataset.col = j;

            if (board[i][j] !== "") {
                cell.textContent = board[i][j];
            }

            cell.addEventListener("click", handleCellClick);

            row.appendChild(cell);
        }

        gameBoard.appendChild(row);
    }
}

// Функция для обработки клика по ячейке доски
function handleCellClick(event) {
    const row = parseInt(event.target.dataset.row);
    const col = parseInt(event.target.dataset.col);

    if (isValidMove(row, col)) {
        board[row][col] = currentPlayer;
        renderBoard();

        if (checkWin(row, col)) {
            alert(`Игрок ${currentPlayer} победил!`);
            resetGame();
            return;
        }

        currentPlayer = currentPlayer === "X" ? "O" : "X";
    }
}

// Функция для проверки допустимости хода
function isValidMove(row, col) {
    return board[row][col] === "";
}

// Функция для проверки победы
function checkWin() {
    for (let i = 0; i < boardSize; i++) {
        for (let j = 0; j < boardSize; j++) {
            if (board[i][j] === "") {
                // Найдена свободная клетка, игра продолжается
                return false;
            }
        }
    }
    // Нет свободных клеток, игра завершается
    return true;
}

// Функция для сброса игры
function resetGame() {
    createBoard();
    renderBoard();
    currentPlayer = "X";
}

// Инициализация игры при загрузке страницы
createBoard();
renderBoard();
document.querySelector("#start-button").addEventListener("click", resetGame);
