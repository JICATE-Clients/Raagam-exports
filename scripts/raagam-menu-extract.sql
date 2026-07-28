-- =============================================================================
-- RAAGAM MENU TREE EXTRACTION - Run all at once in SSMS
-- Database: RAGAM  |  Version: ver_30A (1)  |  Company: 38
-- =============================================================================

IF OBJECT_ID('tempdb..#RaagamMenus') IS NOT NULL DROP TABLE #RaagamMenus;
IF OBJECT_ID('tempdb..#HiddenMenus') IS NOT NULL DROP TABLE #HiddenMenus;

-- STEP 1: Raagam visible menus
SELECT *
INTO #RaagamMenus
FROM vw_Menus M
WHERE
    (
        (M.VersionNos = '' AND M.CompanySlNos = '' AND ISNULL(M.CompanySubSlNos,'') = '')
        OR CHARINDEX(',1,', ',' + REPLACE(M.VersionNos,' ','') + ',') > 0
        OR CHARINDEX(',38,', ',' + REPLACE(M.CompanySlNos,' ','') + ',') > 0
    )
    AND
    (
        (ISNULL(M.NotForVersionNos,'') = '' AND ISNULL(M.NotForCompanySlNos,'') = '')
        OR (
            CHARINDEX(',1,', ',' + REPLACE(ISNULL(M.NotForVersionNos,''),' ','') + ',') = 0
            AND CHARINDEX(',38,', ',' + REPLACE(ISNULL(M.NotForCompanySlNos,''),' ','') + ',') = 0
        )
        OR (
            CHARINDEX(',1,', ',' + REPLACE(ISNULL(M.NotForVersionNos,''),' ','') + ',') > 0
            AND CHARINDEX(',38,', ',' + REPLACE(ISNULL(M.NotForVersionForCompanySlNos,''),' ','') + ',') > 0
        )
    )
    AND CHARINDEX(',0,', ',' + REPLACE(ISNULL(M.NotForCompanySubSlNos,''),' ','') + ',') = 0;

-- STEP 2: Hidden menus
SELECT *
INTO #HiddenMenus
FROM vw_Menus M
WHERE
    NOT (M.VersionNos = '' AND M.CompanySlNos = '' AND ISNULL(M.CompanySubSlNos,'') = '')
    AND CHARINDEX(',1,', ',' + REPLACE(M.VersionNos,' ','') + ',') = 0
    AND CHARINDEX(',38,', ',' + REPLACE(M.CompanySlNos,' ','') + ',') = 0;


-- RESULT 1: Summary counts
SELECT 'Total menus in system' AS Label, COUNT(*) AS Cnt FROM vw_Menus
UNION ALL
SELECT 'Visible to Raagam (ver_30A, co 38)', COUNT(*) FROM #RaagamMenus
UNION ALL
SELECT 'Hidden from Raagam', COUNT(*) FROM #HiddenMenus;


-- RESULT 2: Raagam menu tree (indented hierarchy)
;WITH Tree AS (
    SELECT IDNo, ParentIDNo, SlNo, MenuName, ViewTitle, Type,
           gModuleType, UI_AssemblyName, UI_Name,
           0 AS Lvl,
           CAST(RIGHT('0000' + CAST(SlNo AS VARCHAR), 4) AS VARCHAR(MAX)) AS SortKey
    FROM #RaagamMenus
    WHERE ParentIDNo = 0 OR ParentIDNo IS NULL

    UNION ALL

    SELECT C.IDNo, C.ParentIDNo, C.SlNo, C.MenuName, C.ViewTitle, C.Type,
           C.gModuleType, C.UI_AssemblyName, C.UI_Name,
           T.Lvl + 1,
           CAST(T.SortKey + '.' + RIGHT('0000' + CAST(C.SlNo AS VARCHAR), 4) AS VARCHAR(MAX))
    FROM #RaagamMenus C
    INNER JOIN Tree T ON C.ParentIDNo = T.IDNo
)
SELECT
    Lvl,
    REPLICATE('    ', Lvl) + MenuName AS Menu,
    ViewTitle,
    Type,
    gModuleType,
    UI_AssemblyName,
    UI_Name
FROM Tree
ORDER BY SortKey
OPTION (MAXRECURSION 15);


-- RESULT 3: Hidden from Raagam (DO NOT BUILD list)
SELECT
    MenuName,
    ViewTitle,
    Type,
    gModuleType,
    VersionNos AS ForVersions,
    CompanySlNos AS ForCompanies
FROM #HiddenMenus
ORDER BY gModuleType, MenuName;


-- RESULT 4: Location restrictions
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Menus_LocationInfo')
    SELECT ML.MenuIDNo, R.MenuName, R.ViewTitle, ML.UNITS AS AllowedUnits
    FROM Menus_LocationInfo ML
    LEFT JOIN #RaagamMenus R ON R.IDNo = ML.MenuIDNo
    WHERE ML.CompanySlNo = 38
    ORDER BY ML.MenuIDNo;
ELSE
    PRINT 'No Menus_LocationInfo table - no location restrictions.';


-- RESULT 5: Module-wise breakdown (visible vs hidden per module)
SELECT
    ISNULL(A.gModuleType, H.gModuleType) AS Module,
    ISNULL(A.Visible, 0) AS Visible,
    ISNULL(H.Hidden, 0) AS Hidden
FROM
    (SELECT gModuleType, COUNT(*) AS Visible FROM #RaagamMenus GROUP BY gModuleType) A
FULL OUTER JOIN
    (SELECT gModuleType, COUNT(*) AS Hidden FROM #HiddenMenus GROUP BY gModuleType) H
    ON A.gModuleType = H.gModuleType
ORDER BY Module;


-- Cleanup
DROP TABLE #RaagamMenus;
DROP TABLE #HiddenMenus;
